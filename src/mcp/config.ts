import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getConfigDir } from '../lib/config.js';
import {
  resolveProjectMcpTrust,
  type ProjectMcpTrustInfo,
  type WorkspaceTrustStore,
} from './trust.js';

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export function getMcpConfigPath(): string {
  return path.join(getConfigDir(), 'mcp.json');
}

export function getWorkspaceMcpConfigPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.venice', 'mcp.json');
}

export function mergeMcpConfigs(...configs: McpConfig[]): McpConfig {
  const merged: McpConfig = { mcpServers: {} };
  for (const config of configs) {
    Object.assign(merged.mcpServers, config.mcpServers);
  }
  return merged;
}

export interface LoadMcpConfigOptions {
  warn?: (message: string) => void;
}

export function loadMcpConfig(
  globalPath = getMcpConfigPath(),
  workspacePath?: string,
  options: LoadMcpConfigOptions = {}
): McpConfig {
  const configs: McpConfig[] = [readConfigFile(globalPath, options.warn)];
  if (workspacePath) {
    configs.push(readConfigFile(workspacePath, options.warn));
  }
  return mergeMcpConfigs(...configs);
}

/**
 * Load a config file strictly, throwing on malformed/symlinked content.
 * Mutating commands use this so they never silently discard a corrupted
 * config (VC-KIMI-038).
 */
export function loadMcpConfigStrict(globalPath = getMcpConfigPath()): McpConfig {
  const warnings: string[] = [];
  const config = loadMcpConfig(globalPath, undefined, { warn: (m) => warnings.push(m) });
  if (warnings.length > 0) {
    throw new Error(warnings[0]);
  }
  return config;
}

function readConfigFile(filePath: string, warn?: (message: string) => void): McpConfig {
  if (!fs.existsSync(filePath)) return { mcpServers: {} };

  const fail = (reason: string): McpConfig => {
    // VC-KIMI-038: malformed config must be surfaced, never silently treated
    // as "no servers".
    const message = `MCP config error in ${filePath}: ${reason}`;
    if (warn) warn(message);
    else process.stderr.write(message + '\n');
    return { mcpServers: {} };
  };

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return fail('config path is not a regular file (symbolic links are rejected)');
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      !('mcpServers' in parsed) ||
      typeof (parsed as McpConfig).mcpServers !== 'object' ||
      (parsed as McpConfig).mcpServers === null
    ) {
      return fail('missing or invalid "mcpServers" object');
    }
    return parsed as McpConfig;
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

export interface BuildAgentMcpConfigOptions {
  interactive: boolean;
  globalConfig?: McpConfig;
  store?: WorkspaceTrustStore;
  confirm?: (info: ProjectMcpTrustInfo) => Promise<boolean>;
  warn?: (message: string) => void;
}

/**
 * Assemble the MCP config the agent runtime should use.
 *
 * Global (user-installed) servers are always included; project
 * `.venice/mcp.json` servers are only included after the workspace trust gate
 * (see src/mcp/trust.ts) has approved the exact current config bytes.
 */
export async function buildAgentMcpConfig(
  workspaceRoot: string,
  options: BuildAgentMcpConfigOptions
): Promise<McpConfig> {
  const globalConfig = options.globalConfig ?? loadMcpConfig();
  const workspaceTrust = await resolveProjectMcpTrust({
    workspaceRoot,
    configPath: getWorkspaceMcpConfigPath(workspaceRoot),
    interactive: options.interactive,
    store: options.store,
    confirm: options.confirm,
    warn: options.warn,
  });
  return mergeMcpConfigs(globalConfig, workspaceTrust.config);
}

export function saveMcpConfig(config: McpConfig, filePath = getMcpConfigPath()): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  // VC-KIMI-039: MCP config can contain executable commands and secrets, so
  // its storage must be at least as hardened as the main API config.
  if (fs.existsSync(filePath)) {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`MCP config path is not a regular file: ${filePath}`);
    }
  }

  const temporaryFile = path.join(
    dir,
    `.mcp-${process.pid}-${randomUUID()}.tmp`
  );
  let fileDescriptor: number | undefined;

  try {
    fileDescriptor = fs.openSync(temporaryFile, 'wx', 0o600);
    fs.fchmodSync(fileDescriptor, 0o600);
    fs.writeFileSync(fileDescriptor, JSON.stringify(config, null, 2));
    fs.fsyncSync(fileDescriptor);
    fs.closeSync(fileDescriptor);
    fileDescriptor = undefined;
    fs.renameSync(temporaryFile, filePath);
    fs.chmodSync(filePath, 0o600);
  } catch (error) {
    if (fileDescriptor !== undefined) {
      fs.closeSync(fileDescriptor);
    }
    fs.rmSync(temporaryFile, { force: true });
    throw error;
  }
}
