import * as fs from 'node:fs';
import * as path from 'node:path';
import { getConfigDir } from '../lib/config.js';

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

export function loadMcpConfig(globalPath = getMcpConfigPath(), workspacePath?: string): McpConfig {
  const base: McpConfig = { mcpServers: {} };
  const globalConfig = readConfigFile(globalPath);
  Object.assign(base.mcpServers, globalConfig.mcpServers);
  if (workspacePath) {
    const workspaceConfig = readConfigFile(workspacePath);
    Object.assign(base.mcpServers, workspaceConfig.mcpServers);
  }
  return base;
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

export function saveMcpConfig(config: McpConfig, filePath = getMcpConfigPath()): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), { mode: 0o600 });
}
