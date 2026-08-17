/**
 * Workspace trust gate for project MCP configuration.
 *
 * A repository-controlled `.venice/mcp.json` can name arbitrary executables
 * (e.g. `bash -lc "curl ... | bash"`). That config is NEVER auto-executed
 * without an explicit user approval recorded here. Trust is keyed to the
 * canonical workspace root and the exact bytes of the MCP config file: any
 * change to the file invalidates the previous approval.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { getConfigDir } from '../lib/config.js';
import { getChalk } from '../lib/output.js';
import type { McpConfig } from './config.js';

export interface WorkspaceTrustRecord {
  canonicalWorkspaceRoot: string;
  configHash: string;
  approvedAt: string;
}

export function getMcpTrustStorePath(): string {
  return path.join(getConfigDir(), 'mcp-trust.json');
}

export function hashMcpConfigBytes(bytes: string | Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function canonicalWorkspaceRoot(root: string): string {
  return fs.realpathSync(root);
}

/**
 * Persistent record of which workspace MCP configs the user has approved.
 * Stored under the user config dir with the same atomic-write / 0600
 * hardening used for the main config file, because it gates executable code.
 */
export class WorkspaceTrustStore {
  constructor(private readonly storePath: string = getMcpTrustStorePath()) {}

  private load(): Map<string, WorkspaceTrustRecord> {
    if (!fs.existsSync(this.storePath)) return new Map();
    try {
      const parsed = JSON.parse(fs.readFileSync(this.storePath, 'utf-8')) as {
        workspaces?: WorkspaceTrustRecord[];
      };
      if (!Array.isArray(parsed.workspaces)) return new Map();
      return new Map(parsed.workspaces.map((r) => [r.canonicalWorkspaceRoot, r]));
    } catch {
      return new Map();
    }
  }

  isApproved(root: string, configHash: string): boolean {
    const record = this.load().get(canonicalWorkspaceRoot(root));
    return record !== undefined && record.configHash === configHash;
  }

  getRecord(root: string): WorkspaceTrustRecord | undefined {
    return this.load().get(canonicalWorkspaceRoot(root));
  }

  approve(root: string, configHash: string): void {
    const records = this.load();
    const key = canonicalWorkspaceRoot(root);
    records.set(key, {
      canonicalWorkspaceRoot: key,
      configHash,
      approvedAt: new Date().toISOString(),
    });
    this.save(records);
  }

  revoke(root: string): void {
    const records = this.load();
    records.delete(canonicalWorkspaceRoot(root));
    this.save(records);
  }

  private save(records: Map<string, WorkspaceTrustRecord>): void {
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const data = JSON.stringify({ workspaces: Array.from(records.values()) }, null, 2);
    const temporaryFile = path.join(dir, `.mcp-trust-${process.pid}-${crypto.randomUUID()}.tmp`);
    let fileDescriptor: number | undefined;
    try {
      fileDescriptor = fs.openSync(temporaryFile, 'wx', 0o600);
      fs.fchmodSync(fileDescriptor, 0o600);
      fs.writeFileSync(fileDescriptor, data);
      fs.fsyncSync(fileDescriptor);
      fs.closeSync(fileDescriptor);
      fileDescriptor = undefined;
      fs.renameSync(temporaryFile, this.storePath);
      fs.chmodSync(this.storePath, 0o600);
    } catch (error) {
      if (fileDescriptor !== undefined) {
        try {
          fs.closeSync(fileDescriptor);
        } catch {
          // Ignore close errors while unwinding.
        }
      }
      fs.rmSync(temporaryFile, { force: true });
      throw error;
    }
  }
}

export interface McpServerSummary {
  name: string;
  command: string;
  args?: string[];
  envKeys: string[];
}

export interface ProjectMcpTrustInfo {
  workspaceRoot: string;
  configPath: string;
  configHash: string;
  /** 'new' = never approved; 'changed' = approved before, but the file changed. */
  status: 'new' | 'changed';
  servers: McpServerSummary[];
}

export type ProjectMcpTrustResult =
  | { status: 'no-config'; config: McpConfig }
  | { status: 'approved'; config: McpConfig }
  | { status: 'skipped'; config: McpConfig; reason: 'untrusted' | 'config-changed' | 'declined' };

export interface ResolveProjectMcpTrustOptions {
  workspaceRoot: string;
  configPath: string;
  interactive: boolean;
  store?: WorkspaceTrustStore;
  confirm?: (info: ProjectMcpTrustInfo) => Promise<boolean>;
  warn?: (message: string) => void;
}

export function summarizeServers(config: McpConfig): McpServerSummary[] {
  return Object.entries(config.mcpServers)
    .filter(([, server]) => !server.disabled)
    .map(([name, server]) => ({
      name,
      command: server.command,
      args: server.args,
      envKeys: Object.keys(server.env ?? {}),
    }));
}

/**
 * Decide which project `.venice/mcp.json` servers may start.
 *
 * Rules:
 * 1. No file, malformed file, or no runnable servers => nothing to gate.
 * 2. A recorded approval whose hash matches the current file => approved.
 * 3. Otherwise the workspace is untrusted:
 *    - interactive: ask the user, recording the approval on acceptance;
 *    - noninteractive: fail closed — skip project MCP with a warning.
 */
export async function resolveProjectMcpTrust(
  options: ResolveProjectMcpTrustOptions
): Promise<ProjectMcpTrustResult> {
  const { workspaceRoot, configPath, interactive } = options;
  const warn =
    options.warn ??
    ((message: string) => {
      console.error(message);
    });

  if (!fs.existsSync(configPath)) {
    return { status: 'no-config', config: { mcpServers: {} } };
  }

  const rawBytes = fs.readFileSync(configPath);
  let parsed: McpConfig;
  try {
    parsed = JSON.parse(rawBytes.toString('utf-8')) as McpConfig;
  } catch {
    warn(
      `Warning: project MCP config at ${configPath} is not valid JSON and was ignored.`
    );
    return { status: 'no-config', config: { mcpServers: {} } };
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !parsed.mcpServers ||
    typeof parsed.mcpServers !== 'object'
  ) {
    return { status: 'no-config', config: { mcpServers: {} } };
  }

  const servers = summarizeServers(parsed);
  if (servers.length === 0) {
    return { status: 'no-config', config: parsed };
  }

  const configHash = hashMcpConfigBytes(rawBytes);
  const store = options.store ?? new WorkspaceTrustStore();
  const record = store.getRecord(workspaceRoot);

  if (record && record.configHash === configHash) {
    return { status: 'approved', config: parsed };
  }

  const info: ProjectMcpTrustInfo = {
    workspaceRoot,
    configPath,
    configHash,
    status: record ? 'changed' : 'new',
    servers,
  };

  if (!interactive) {
    warn(
      `Warning: project MCP config at ${configPath} was NOT loaded because this workspace is not trusted.`
    );
    warn(`Run 'venice mcp trust' once to review and approve project MCP servers.`);
    return {
      status: 'skipped',
      config: { mcpServers: {} },
      reason: record ? 'config-changed' : 'untrusted',
    };
  }

  const confirm = options.confirm ?? defaultConfirmTrust;
  const approved = await confirm(info);
  if (approved) {
    store.approve(workspaceRoot, configHash);
    return { status: 'approved', config: parsed };
  }

  warn('Project MCP servers were not approved and will not be started.');
  return { status: 'skipped', config: { mcpServers: {} }, reason: 'declined' };
}

/** Human-readable trust prompt (also used by `venice mcp trust`). */
export function formatTrustPrompt(info: ProjectMcpTrustInfo): string {
  const c = getChalk();
  const lines: string[] = [];
  lines.push('');
  lines.push(c.yellow('⚠  Project MCP servers require approval'));
  lines.push(`  Workspace: ${c.bold(info.workspaceRoot)}`);
  lines.push(`  Config:    ${info.configPath}`);
  lines.push(
    `  Hash:      ${info.configHash.slice(0, 12)}… (${
      info.status === 'changed'
        ? 'config changed since last approval'
        : 'not previously approved'
    })`
  );
  for (const server of info.servers) {
    lines.push('');
    lines.push(`  Server "${c.bold(server.name)}":`);
    lines.push(`    command: ${server.command}`);
    if (server.args?.length) {
      lines.push(`    args:    ${server.args.map((a) => JSON.stringify(a)).join(' ')}`);
    }
    if (server.envKeys.length) {
      lines.push(`    env keys: ${server.envKeys.join(', ')} (values are not shown)`);
    } else {
      lines.push(`    env keys: (none)`);
    }
  }
  lines.push('');
  lines.push(
    `Approving grants ${c.bold('workspace execution trust')}: the servers above may run ${c.bold('executable code')} in this workspace.`
  );
  lines.push(
    'The executables they reference (scripts, npx packages, commands) may change after approval and remain trusted;'
  );
  lines.push('only a change to this MCP config file invalidates this approval.');
  return lines.join('\n');
}

/** Default interactive confirmation. Declines when stdin/stdout are not TTYs. */
export async function defaultConfirmTrust(info: ProjectMcpTrustInfo): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }
  const c = getChalk();
  console.log(formatTrustPrompt(info));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(c.bold('Approve these MCP servers? [y/N] '));
    const normalized = answer.trim().toLowerCase();
    return normalized === 'y' || normalized === 'yes';
  } finally {
    rl.close();
  }
}
