/**
 * Doctor command — executable diagnostics for the Venice CLI.
 *
 * Each check returns a structured result with an explicit severity so the
 * aggregate command can exit deterministically (VC-KIMI-018):
 *   0 = no errors, 1 = one or more errors.
 */

import { Command } from 'commander';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import { getChalk } from '../lib/output.js';
import { SESSIONS_ROOT } from '../agent/sessions.js';
import { listModels } from '../lib/api.js';
import { getConfigPath, loadConfig } from '../lib/config.js';
import { getMcpConfigPath, getWorkspaceMcpConfigPath } from '../mcp/config.js';
import type { McpConfig } from '../mcp/config.js';
import {
  WorkspaceTrustStore,
  hashMcpConfigBytes,
  summarizeServers,
} from '../mcp/trust.js';
import { detectWorkspaceRoot } from '../agent/runtime.js';
import {
  SkillRegistry,
  getGlobalSkillsDir,
  getProjectSkillsDir,
} from '../skills/registry.js';

export interface DoctorCheck {
  id: string;
  severity: 'ok' | 'warning' | 'error';
  message: string;
  remediation?: string;
}

type CheckResult = DoctorCheck | DoctorCheck[];

function icon(severity: DoctorCheck['severity'], c: ReturnType<typeof getChalk>): string {
  if (severity === 'ok') return c.green('✅');
  if (severity === 'warning') return c.yellow('⚠️');
  return c.red('❌');
}

function renderChecks(checks: DoctorCheck[], title: string): number {
  const c = getChalk();
  console.log(c.bold(`🩺 Venice Doctor: ${title}\n`));
  let errors = 0;
  for (const check of checks) {
    console.log(`${icon(check.severity, c)} ${check.message}`);
    if (check.remediation) {
      console.log(`   ${c.dim(check.remediation)}`);
    }
    if (check.severity === 'error') errors++;
  }
  console.log('');
  return errors;
}

function finish(checks: CheckResult, title: string): void {
  const list = Array.isArray(checks) ? checks : [checks];
  const errors = renderChecks(list, title);
  if (errors === 0) {
    console.log(getChalk().green('🎉 All checks passed!'));
  } else {
    console.log(getChalk().yellow(`⚠️  Found ${errors} error(s) that require attention.`));
  }
  process.exitCode = errors > 0 ? 1 : 0;
}

async function finishAsync(checks: Promise<CheckResult>, title: string): Promise<void> {
  try {
    finish(await checks, title);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finish({ id: 'fatal', severity: 'error', message }, title);
  }
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function isPosix(): boolean {
  return process.platform !== 'win32';
}

function permissionBits(stats: fs.Stats): number {
  return stats.mode & 0o777;
}

function checkConfig(): DoctorCheck[] {
  const configPath = getConfigPath();
  const checks: DoctorCheck[] = [];

  if (!fs.existsSync(configPath)) {
    checks.push({
      id: 'config.present',
      severity: 'ok',
      message: `No config file at ${configPath} (using built-in defaults)`,
    });
    return checks;
  }

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(configPath);
  } catch (error) {
    checks.push({
      id: 'config.stat',
      severity: 'error',
      message: `Cannot stat config file: ${error instanceof Error ? error.message : String(error)}`,
    });
    return checks;
  }

  if (stat.isSymbolicLink()) {
    checks.push({
      id: 'config.symlink',
      severity: 'error',
      message: `Config file is a symbolic link: ${configPath}`,
      remediation: 'Remove the symlink and recreate the config with "venice config set".',
    });
    return checks;
  }

  if (!stat.isFile()) {
    checks.push({
      id: 'config.regular',
      severity: 'error',
      message: `Config path is not a regular file: ${configPath}`,
    });
    return checks;
  }

  try {
    JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    checks.push({ id: 'config.parse', severity: 'ok', message: `Config parses as JSON: ${configPath}` });
  } catch (error) {
    checks.push({
      id: 'config.parse',
      severity: 'error',
      message: `Config is malformed JSON: ${error instanceof Error ? error.message : String(error)}`,
      remediation: 'Repair or remove the file, then re-run "venice config set".',
    });
  }

  if (isPosix() && permissionBits(stat) !== 0o600) {
    checks.push({
      id: 'config.permissions',
      severity: 'warning',
      message: `Config file permissions are ${(permissionBits(stat)).toString(8)} (expected 600)`,
      remediation: 'Run "chmod 600" on the config file.',
    });
  } else {
    checks.push({ id: 'config.permissions', severity: 'ok', message: 'Config file permissions are safe' });
  }

  return checks;
}

function checkApi(): DoctorCheck[] {
  const specPath = fileURLToPath(new URL('../../docs/swagger.yaml', import.meta.url));
  const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url));
  const checks: DoctorCheck[] = [];

  if (fs.existsSync(specPath)) {
    checks.push({ id: 'api.spec', severity: 'ok', message: `Pinned API spec present: ${specPath}` });
  } else {
    checks.push({
      id: 'api.spec',
      severity: 'warning',
      message: 'Pinned API spec not present (installed package)',
      remediation: 'Run "npm run api:contract" from a source checkout for the drift check.',
    });
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { scripts?: Record<string, string> };
    if (pkg.scripts?.['api:contract']) {
      checks.push({ id: 'api.contract-script', severity: 'ok', message: 'api:contract script is wired' });
    } else {
      checks.push({
        id: 'api.contract-script',
        severity: 'error',
        message: 'package.json has no api:contract script',
        remediation: 'Add "api:contract": "node scripts/api-drift-check.mjs" to package.json.',
      });
    }
  } catch (error) {
    checks.push({
      id: 'api.package',
      severity: 'error',
      message: `Cannot read package.json: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return checks;
}

async function checkModels(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  try {
    const models = await listModels({ showSpinner: false });
    checks.push({
      id: 'models.fetch',
      severity: 'ok',
      message: `Fetched ${models.length} live models from the Venice API`,
    });

    const ids = new Set(models.map((m) => m.id));
    const config = loadConfig();
    for (const key of ['default_model', 'default_image_model'] as const) {
      const configured = config[key];
      if (configured && !ids.has(configured)) {
        checks.push({
          id: `models.${key}`,
          severity: 'warning',
          message: `Configured ${key} "${configured}" is not in the live catalog`,
          remediation: 'Update it with "venice config set ' + key + ' <id>".',
        });
      }
    }
  } catch (error) {
    checks.push({
      id: 'models.fetch',
      severity: 'error',
      message: `Failed to fetch models: ${error instanceof Error ? error.message : String(error)}`,
      remediation: 'Check your network connection and API key.',
    });
  }
  return checks;
}

function readMcpFile(filePath: string): { servers: number; malformed?: string } {
  if (!fs.existsSync(filePath)) return { servers: 0 };
  try {
    const config = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as McpConfig;
    return { servers: Object.keys(config?.mcpServers ?? {}).length };
  } catch (error) {
    return {
      servers: 0,
      malformed: error instanceof Error ? error.message : String(error),
    };
  }
}

function checkMcp(workspaceRoot: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const globalPath = getMcpConfigPath();
  const global = readMcpFile(globalPath);

  if (global.malformed) {
    checks.push({
      id: 'mcp.global',
      severity: 'error',
      message: `Global MCP config is malformed JSON: ${globalPath} (${global.malformed})`,
      remediation: 'Repair or remove the file, then re-run "venice mcp".',
    });
  } else if (global.servers > 0) {
    checks.push({
      id: 'mcp.global',
      severity: 'ok',
      message: `Global MCP config declares ${global.servers} server(s): ${globalPath}`,
    });
  } else {
    checks.push({ id: 'mcp.global', severity: 'ok', message: 'No global MCP servers configured' });
  }

  const projectPath = getWorkspaceMcpConfigPath(workspaceRoot);
  const project = readMcpFile(projectPath);

  if (project.malformed) {
    checks.push({
      id: 'mcp.project',
      severity: 'error',
      message: `Project MCP config is malformed JSON: ${projectPath} (${project.malformed})`,
      remediation: 'Repair or remove the file.',
    });
  } else if (project.servers === 0) {
    checks.push({ id: 'mcp.project', severity: 'ok', message: 'No project MCP servers configured' });
  } else {
    let trusted = false;
    try {
      const store = new WorkspaceTrustStore();
      trusted = store.isApproved(workspaceRoot, hashMcpConfigBytes(fs.readFileSync(projectPath)));
    } catch {
      trusted = false;
    }
    if (trusted) {
      checks.push({
        id: 'mcp.project',
        severity: 'ok',
        message: `Project MCP config (${project.servers} server(s)) is trusted`,
      });
    } else {
      checks.push({
        id: 'mcp.project',
        severity: 'error',
        message: `Untrusted project MCP config at ${projectPath} (${project.servers} server(s) will not start)`,
        remediation: 'Approve it with "venice mcp trust".',
      });
    }
  }

  return checks;
}

function checkSkills(workspaceRoot: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const registry = new SkillRegistry(getGlobalSkillsDir(), getProjectSkillsDir(workspaceRoot));
  registry.discover();
  const skills = registry.list();

  if (skills.length > 0) {
    checks.push({
      id: 'skills.discovered',
      severity: 'ok',
      message: `Discovered ${skills.length} skill(s)`,
    });
  } else {
    checks.push({
      id: 'skills.discovered',
      severity: 'ok',
      message: 'No skills discovered (optional)',
    });
  }

  for (const error of registry.getErrors()) {
    checks.push({
      id: 'skills.discovery-error',
      severity: 'error',
      message: error,
    });
  }

  if (!fs.existsSync(getGlobalSkillsDir()) && !fs.existsSync(getProjectSkillsDir(workspaceRoot))) {
    checks.push({
      id: 'skills.dirs',
      severity: 'ok',
      message: `No skills directories present (global: ${getGlobalSkillsDir()}, project: ${getProjectSkillsDir(workspaceRoot)})`,
    });
  }

  return checks;
}

function checkSessions(): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  if (!fs.existsSync(SESSIONS_ROOT)) {
    checks.push({ id: 'sessions.dir', severity: 'ok', message: `No sessions directory at ${SESSIONS_ROOT}` });
    return checks;
  }

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(SESSIONS_ROOT);
  } catch (error) {
    checks.push({
      id: 'sessions.stat',
      severity: 'error',
      message: `Cannot stat sessions directory: ${error instanceof Error ? error.message : String(error)}`,
    });
    return checks;
  }

  if (isPosix() && permissionBits(stat) !== 0o700) {
    checks.push({
      id: 'sessions.permissions',
      severity: 'error',
      message: `Sessions directory permissions are ${permissionBits(stat).toString(8)} (expected 700): ${SESSIONS_ROOT}`,
      remediation: 'Run "chmod 700" on the sessions directory.',
    });
  } else {
    checks.push({ id: 'sessions.permissions', severity: 'ok', message: 'Sessions directory permissions are safe' });
  }

  try {
    const entries = fs.readdirSync(SESSIONS_ROOT, { withFileTypes: true });
    const sessionCount = entries.filter((entry) => entry.isDirectory()).length;
    checks.push({
      id: 'sessions.count',
      severity: 'ok',
      message: `${sessionCount} session(s) stored`,
    });
  } catch {
    checks.push({ id: 'sessions.read', severity: 'error', message: 'Cannot list sessions directory' });
  }

  return checks;
}

function checkSecurity(workspaceRoot: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  if (process.env.VENICE_DANGEROUS_SHELL_ENABLED === 'true' || process.env.VENICE_ALLOW_SHELL === 'true') {
    checks.push({
      id: 'security.shell-env',
      severity: 'warning',
      message: 'Unsafe shell execution mode is enabled via environment variables',
      remediation: 'Unset VENICE_DANGEROUS_SHELL_ENABLED and VENICE_ALLOW_SHELL.',
    });
  } else {
    checks.push({ id: 'security.shell-env', severity: 'ok', message: 'Unsafe shell execution mode is disabled' });
  }

  const projectPath = getWorkspaceMcpConfigPath(workspaceRoot);
  if (fs.existsSync(projectPath)) {
    try {
      const servers = summarizeServers(
        JSON.parse(fs.readFileSync(projectPath, 'utf-8')) as McpConfig
      );
      if (servers.length > 0) {
        const store = new WorkspaceTrustStore();
        const approved = store.isApproved(
          workspaceRoot,
          hashMcpConfigBytes(fs.readFileSync(projectPath))
        );
        if (approved) {
          checks.push({ id: 'security.mcp-trust', severity: 'ok', message: 'Project MCP config is trusted' });
        } else {
          checks.push({
            id: 'security.mcp-trust',
            severity: 'error',
            message: `Untrusted project MCP config at ${projectPath} (${servers.map((s) => s.name).join(', ')})`,
            remediation: 'Approve it with "venice mcp trust".',
          });
        }
      } else {
        checks.push({ id: 'security.mcp-trust', severity: 'ok', message: 'No project MCP servers to trust' });
      }
    } catch (error) {
      checks.push({
        id: 'security.mcp-trust',
        severity: 'error',
        message: `Cannot read project MCP config: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  } else {
    checks.push({ id: 'security.mcp-trust', severity: 'ok', message: 'No project MCP config in this workspace' });
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerDoctorCommand(program: Command): void {
  const doctorCmd = program.command('doctor').description('Run diagnostic health checks');

  doctorCmd
    .command('config')
    .description('Check configuration file integrity')
    .action(() => finish(checkConfig(), 'Config Health'));

  doctorCmd
    .command('api')
    .description('Check API schema synchronization status')
    .action(() => finish(checkApi(), 'API Health'));

  doctorCmd
    .command('models')
    .description('Check model catalog availability and stale defaults')
    .action(() => finishAsync(checkModels(), 'Models Health'));

  doctorCmd
    .command('mcp')
    .description('Check MCP configuration and trust policy')
    .action(() => {
      const workspaceRoot = detectWorkspaceRoot(process.cwd());
      finish(checkMcp(workspaceRoot), 'MCP Health');
    });

  doctorCmd
    .command('skills')
    .description('Check skill discovery')
    .action(() => {
      const workspaceRoot = detectWorkspaceRoot(process.cwd());
      finish(checkSkills(workspaceRoot), 'Skills Health');
    });

  doctorCmd
    .command('sessions')
    .description('Check session store integrity and permissions')
    .action(() => finish(checkSessions(), 'Sessions Health'));

  doctorCmd
    .command('security')
    .description('Check security-sensitive configuration')
    .action(() => {
      const workspaceRoot = detectWorkspaceRoot(process.cwd());
      finish(checkSecurity(workspaceRoot), 'Security Health');
    });

  // Bare `venice doctor` runs every check and aggregates the result.
  doctorCmd.action(async () => {
    const workspaceRoot = detectWorkspaceRoot(process.cwd());
    const checks: DoctorCheck[] = [
      ...checkConfig(),
      ...checkApi(),
      ...(await checkModels()),
      ...checkMcp(workspaceRoot),
      ...checkSkills(workspaceRoot),
      ...checkSessions(),
      ...checkSecurity(workspaceRoot),
    ];
    const errors = renderChecks(checks, 'Full Health Check');
    if (errors === 0) {
      console.log(getChalk().green('🎉 All checks passed!'));
    } else {
      console.log(getChalk().yellow(`⚠️  Found ${errors} error(s) that require attention.`));
    }
    process.exitCode = errors > 0 ? 1 : 0;
  });
}
