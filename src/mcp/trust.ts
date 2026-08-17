/**
 * Workspace trust gate for project MCP configuration.
 *
 * A repository-controlled `.venice/mcp.json` can name arbitrary executables
 * (e.g. `bash -lc "curl ... | bash"`). That config is NEVER auto-executed
 * without an explicit user approval recorded here.
 *
 * Trust follows an **exact executable provenance** contract (VCL-R3-017): an
 * approval is keyed to the canonical workspace root, the exact bytes of the
 * MCP config file, AND the executables it references. Local scripts are
 * content-hashed at approval time, so changing a referenced script
 * invalidates the approval. Mutable package commands (e.g. `npx pkg@latest`)
 * are fingerprinted as mutable and flagged in the prompt so the user knows
 * they may resolve to different code over time.
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
  /**
   * Exact-executable-provenance fingerprints recorded at approval time. A
   * local script whose content changed, or a command line that changed,
   * invalidates the approval (VCL-R3-017).
   */
  executables: ExecutableFingerprint[];
}

/** How an MCP server's executable is fingerprinted. */
export type ExecutableFingerprintKind = 'file' | 'mutable' | 'system';

export interface ExecutableFingerprint {
  /** Server name this fingerprint belongs to. */
  server: string;
  /** The full command line (command + args joined). */
  commandLine: string;
  kind: ExecutableFingerprintKind;
  /** sha256 of the local file bytes (kind === 'file'). */
  fileHash?: string;
  /** Realpath of the hashed local file (kind === 'file'). */
  filePath?: string;
  /** True when a package command may resolve to different code (kind === 'mutable'). */
  mutable?: boolean;
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

  /**
   * True when a recorded approval matches the config hash AND — when
   * `executables` is supplied — the exact executable fingerprints (VCL-R3-017).
   * Callers that only have the config hash (legacy checks) omit the
   * fingerprints and get the config-hash-only answer.
   */
  isApproved(root: string, configHash: string, executables?: ExecutableFingerprint[]): boolean {
    const record = this.load().get(canonicalWorkspaceRoot(root));
    if (!record || record.configHash !== configHash) return false;
    if (executables === undefined) return true;
    return executablesMatch(record.executables, executables);
  }

  getRecord(root: string): WorkspaceTrustRecord | undefined {
    return this.load().get(canonicalWorkspaceRoot(root));
  }

  approve(root: string, configHash: string, executables: ExecutableFingerprint[] = []): void {
    const records = this.load();
    const key = canonicalWorkspaceRoot(root);
    records.set(key, {
      canonicalWorkspaceRoot: key,
      configHash,
      approvedAt: new Date().toISOString(),
      executables,
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
  /** 'new' = never approved; 'changed' = approved before, but something changed. */
  status: 'new' | 'changed';
  /** What invalidated a prior approval: the config bytes or a referenced executable. */
  drift?: 'config' | 'executable';
  /** Exact-executable-provenance fingerprints shown in the prompt (VCL-R3-017). */
  executables?: ExecutableFingerprint[];
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

/** Package runners whose first package spec may resolve to different code. */
const PACKAGE_RUNNERS = new Set(['npx', 'npmx', 'bunx', 'npm', 'yarn', 'pnpm']);

/** True when a package spec is not pinned to a concrete version. */
export function isMutablePackageSpec(spec: string): boolean {
  const trimmed = spec.trim();
  if (!trimmed) return true;
  // @latest / @* / trailing @ are always mutable.
  if (trimmed.includes('@latest') || trimmed.includes('@*') || trimmed.endsWith('@')) return true;
  // A scoped or unscoped name with an explicit @version is pinned.
  // @scope/pkg@1.2.3 or pkg@1.2.3
  if (trimmed.startsWith('@')) {
    const secondAt = trimmed.indexOf('@', 1);
    return secondAt === -1; // bare @scope/pkg without version
  }
  const at = trimmed.indexOf('@');
  return at === -1; // bare name resolves to latest
}

/**
 * Fingerprint the executables a server references (VCL-R3-017).
 *
 * - A local script (relative to the workspace or absolute) is content-hashed:
 *   changing its bytes invalidates trust.
 * - A package runner with a mutable spec (`npx pkg@latest`) is flagged as
 *   mutable so the prompt is honest about drift.
 * - Everything else (a system binary like bash/node) is treated as
 *   OS-managed and not content-hashed.
 */
export function fingerprintServerExecutables(
  servers: McpServerSummary[],
  workspaceRoot: string
): ExecutableFingerprint[] {
  return servers.map((server) => {
    const commandLine = [server.command, ...(server.args ?? [])].join(' ');
    // A direct local script, or a script passed to a known interpreter
    // (e.g. `node ./server.js`), is content-hashed.
    const localPath =
      resolveLocalExecutable(server.command, workspaceRoot) ??
      resolveInterpreterScript(server.command, server.args ?? [], workspaceRoot);
    if (localPath) {
      try {
        const fileHash = hashMcpConfigBytes(fs.readFileSync(localPath));
        return {
          server: server.name,
          commandLine,
          kind: 'file',
          fileHash,
          filePath: localPath,
        };
      } catch {
        // Unreadable/nonexistent referenced file: fall through to system.
      }
    }
    const spec = packageSpec(server.command, server.args ?? []);
    if (spec !== undefined) {
      return {
        server: server.name,
        commandLine,
        kind: 'mutable',
        mutable: isMutablePackageSpec(spec),
      };
    }
    return { server: server.name, commandLine, kind: 'system' };
  });
}

/** Interpreters whose first positional arg is commonly a local script. */
const INTERPRETERS = new Set(['node', 'python', 'python3', 'bash', 'sh', 'zsh', 'tsx', 'deno', 'bun']);

/** Resolve a script passed to a known interpreter, if it exists locally. */
function resolveInterpreterScript(
  command: string,
  args: string[],
  workspaceRoot: string
): string | undefined {
  if (!INTERPRETERS.has(command) || !args.length) return undefined;
  return resolveLocalExecutable(args[0], workspaceRoot);
}

/** Resolve a command to a local file path, if it looks like one and exists. */
function resolveLocalExecutable(command: string, workspaceRoot: string): string | undefined {
  if (!command) return undefined;
  const looksLikePath =
    command.includes('/') ||
    command.includes('\\') ||
    command.startsWith('.') ||
    command.startsWith('~');
  if (!looksLikePath) return undefined;
  const candidate = path.isAbsolute(command)
    ? command
    : path.resolve(workspaceRoot, command);
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return fs.realpathSync(candidate);
  }
  return undefined;
}

/** Extract the package spec from a package-runner command, if any. */
function packageSpec(command: string, args: string[]): string | undefined {
  if (!PACKAGE_RUNNERS.has(command)) return undefined;
  const rest = args.filter((a) => !a.startsWith('-'));
  if (command === 'npm' || command === 'yarn' || command === 'pnpm') {
    // npm exec <pkg>, yarn dlx <pkg>, pnpm dlx <pkg>
    if (rest[0] === 'exec' || rest[0] === 'dlx') return rest[1];
    return undefined;
  }
  // npx / npmx / bunx <pkg>
  return rest[0];
}

/** Compare two fingerprint lists for exact equality (order-insensitive). */
export function executablesMatch(
  recorded: ExecutableFingerprint[] | undefined,
  current: ExecutableFingerprint[] | undefined
): boolean {
  if (!recorded || !current) return recorded === current;
  if (recorded.length !== current.length) return false;
  const recordedJson = new Set(recorded.map((e) => JSON.stringify(e)));
  return current.every((e) => recordedJson.has(JSON.stringify(e)));
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
  // Exact executable provenance: fingerprint the referenced executables so a
  // changed local script invalidates a prior approval (VCL-R3-017).
  const executables = fingerprintServerExecutables(servers, workspaceRoot);
  const store = options.store ?? new WorkspaceTrustStore();
  const record = store.getRecord(workspaceRoot);

  if (
    record &&
    record.configHash === configHash &&
    executablesMatch(record.executables, executables)
  ) {
    return { status: 'approved', config: parsed };
  }

  const info: ProjectMcpTrustInfo = {
    workspaceRoot,
    configPath,
    configHash,
    executables,
    status: record ? 'changed' : 'new',
    drift: record
      ? record.configHash !== configHash
        ? 'config'
        : 'executable'
      : undefined,
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
    store.approve(workspaceRoot, configHash, executables);
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
        ? info.drift === 'executable'
          ? 'a referenced executable changed since last approval'
          : 'config changed since last approval'
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
    const exec = info.executables?.find((e) => e.server === server.name);
    if (exec) {
      if (exec.kind === 'file' && exec.filePath && exec.fileHash) {
        lines.push(`    executable: local script ${exec.filePath} (sha256 ${exec.fileHash.slice(0, 12)}…)`);
      } else if (exec.kind === 'mutable') {
        lines.push(
          `    executable: package command ${exec.commandLine}${exec.mutable
            ? ' (MUTABLE: may resolve to different code; pin a version to lock it)'
            : ''}`
        );
      } else {
        lines.push(`    executable: system binary ${exec.commandLine}`);
      }
    }
  }
  lines.push('');
  lines.push(
    `Approving grants ${c.bold('exact executable provenance trust')}: the servers above may run ${c.bold('executable code')} in this workspace.`
  );
  lines.push(
    'Local scripts referenced by the config are content-hashed at approval time; changing a referenced script invalidates this approval.'
  );
  lines.push(
    'Mutable package commands (e.g. npx package@latest) are flagged and may resolve to different code over time; pin a version to lock them.'
  );
  lines.push('Only a change to this MCP config file or a referenced local script invalidates this approval.');
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
