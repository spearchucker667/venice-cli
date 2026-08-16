import * as fs from 'node:fs';
import * as path from 'node:path';
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

export function loadMcpConfig(globalPath = getMcpConfigPath(), workspacePath?: string): McpConfig {
  const configs: McpConfig[] = [readConfigFile(globalPath)];
  if (workspacePath) {
    configs.push(readConfigFile(workspacePath));
  }
  return mergeMcpConfigs(...configs);
}

function readConfigFile(filePath: string): McpConfig {
  if (!fs.existsSync(filePath)) return { mcpServers: {} };
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as McpConfig;
    if (!parsed || typeof parsed !== 'object' || !parsed.mcpServers) {
      return { mcpServers: {} };
    }
    return parsed;
  } catch {
    return { mcpServers: {} };
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
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), { mode: 0o600 });
}
