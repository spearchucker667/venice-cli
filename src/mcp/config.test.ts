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

  it('surfaces malformed JSON through the warn callback instead of silently dropping servers', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-malformed-'));
    const file = path.join(dir, 'mcp.json');
    fs.writeFileSync(file, '{ not valid json');
    const warnings: string[] = [];
    const config = loadMcpConfig(file, undefined, { warn: (m) => warnings.push(m) });
    assert.deepStrictEqual(config, { mcpServers: {} });
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0], /MCP config error/);
  });

  it('surfaces a missing mcpServers object', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-shape-'));
    const file = path.join(dir, 'mcp.json');
    fs.writeFileSync(file, JSON.stringify({ servers: [] }));
    const warnings: string[] = [];
    const config = loadMcpConfig(file, undefined, { warn: (m) => warnings.push(m) });
    assert.deepStrictEqual(config, { mcpServers: {} });
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0], /mcpServers/);
  });

  it('rejects a symbolic-link config on load', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-symlink-load-'));
    const target = path.join(dir, 'target.json');
    const link = path.join(dir, 'mcp.json');
    fs.writeFileSync(target, JSON.stringify({ mcpServers: { a: { command: 'echo' } } }));
    fs.symlinkSync(target, link);
    const warnings: string[] = [];
    const config = loadMcpConfig(link, undefined, { warn: (m) => warnings.push(m) });
    assert.deepStrictEqual(config, { mcpServers: {} });
    assert.strictEqual(warnings.length, 1);
    assert.match(warnings[0], /symbolic link/);
  });

  it('rejects saving over a symbolic-link path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-symlink-save-'));
    const target = path.join(dir, 'target.json');
    const link = path.join(dir, 'mcp.json');
    fs.writeFileSync(target, '{}');
    fs.symlinkSync(target, link);
    assert.throws(
      () => saveMcpConfig({ mcpServers: { a: { command: 'echo' } } }, link),
      /not a regular file/
    );
  });

  it(
    'saves with atomic write and 0600 permissions',
    { skip: process.platform === 'win32' },
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-perms-'));
      const file = path.join(dir, 'mcp.json');
      saveMcpConfig({ mcpServers: { a: { command: 'echo' } } }, file);
      const stat = fs.statSync(file);
      assert.strictEqual(stat.mode & 0o777, 0o600);
      const leftovers = fs.readdirSync(dir).filter((name) => name.startsWith('.mcp-'));
      assert.deepStrictEqual(leftovers, []);
    }
  );
});
