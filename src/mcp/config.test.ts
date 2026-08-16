import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadMcpConfig, saveMcpConfig, getMcpConfigPath, getWorkspaceMcpConfigPath } from './config.js';

describe('MCP config', () => {
  it('loads a global mcp.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-config-test-'));
    const file = path.join(dir, 'mcp.json');
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { memory: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] } } }));
    const config = loadMcpConfig(file);
    assert.strictEqual(config.mcpServers.memory.command, 'npx');
    assert.deepStrictEqual(config.mcpServers.memory.args, ['-y', '@modelcontextprotocol/server-memory']);
  });

  it('merges workspace config over global config', () => {
    const globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-global-'));
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-workspace-'));
    const globalFile = path.join(globalDir, 'mcp.json');
    const workspaceFile = path.join(workspaceDir, 'mcp.json');
    fs.writeFileSync(globalFile, JSON.stringify({ mcpServers: { a: { command: 'global' } } }));
    fs.writeFileSync(workspaceFile, JSON.stringify({ mcpServers: { a: { command: 'workspace' } } }));
    const config = loadMcpConfig(globalFile, workspaceFile);
    assert.strictEqual(config.mcpServers.a.command, 'workspace');
  });

  it('returns empty config when files are missing', () => {
    const config = loadMcpConfig(path.join(os.tmpdir(), 'does-not-exist.json'));
    assert.deepStrictEqual(config, { mcpServers: {} });
  });

  it('returns default path in ~/.venice/mcp.json', () => {
    const configPath = getMcpConfigPath();
    assert.ok(configPath.endsWith('mcp.json'));
    assert.ok(configPath.includes('.venice'));
  });

  it('returns workspace path under .venice/mcp.json', () => {
    const workspacePath = getWorkspaceMcpConfigPath('/tmp/project');
    assert.strictEqual(workspacePath, path.join('/tmp/project', '.venice', 'mcp.json'));
  });

  it('saves and reloads config', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-save-'));
    const file = path.join(dir, 'mcp.json');
    saveMcpConfig({ mcpServers: { echo: { command: 'node', args: ['server.js'] } } }, file);
    const config = loadMcpConfig(file);
    assert.strictEqual(config.mcpServers.echo.command, 'node');
    assert.deepStrictEqual(config.mcpServers.echo.args, ['server.js']);
  });
});
