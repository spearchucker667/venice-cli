import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { registerMcpCommand } from './mcp.js';

const cliPath = fileURLToPath(new URL('../index.js', import.meta.url));

function runCli(args: string[], homeDir: string) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      APPDATA: homeDir,
      LOCALAPPDATA: homeDir,
      NO_COLOR: '1',
    },
  });
}

function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; stdout: string; stderr: string }> {
  const originalStdout = process.stdout.write.bind(process.stdout);
  const originalStderr = process.stderr.write.bind(process.stderr);
  let stdout = '';
  let stderr = '';
  process.stdout.write = (chunk: any) => {
    stdout += String(chunk);
    return true;
  };
  process.stderr.write = (chunk: any) => {
    stderr += String(chunk);
    return true;
  };
  return fn()
    .then((result) => ({ result, stdout, stderr }))
    .finally(() => {
      process.stdout.write = originalStdout;
      process.stderr.write = originalStderr;
    });
}

describe('registerMcpCommand', () => {
  it('lists configured servers', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-cmd-'));
    const file = path.join(dir, 'mcp.json');
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { echo: { command: 'node', args: ['server.js'] } } }));
    const program = new Command();
    registerMcpCommand(program, file);
    const { stdout } = await captureLogs(() => program.parseAsync(['node', 'venice', 'mcp', 'list']));
    assert.ok(stdout.includes('echo'));
  });

  it('adds a server', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-cmd-'));
    const file = path.join(dir, 'mcp.json');
    const program = new Command();
    registerMcpCommand(program, file);
    await captureLogs(() =>
      program.parseAsync(['node', 'venice', 'mcp', 'add', 'memory', '--command', 'npx', '--args', '-y', '@modelcontextprotocol/server-memory'])
    );
    const config = JSON.parse(fs.readFileSync(file, 'utf-8'));
    assert.strictEqual(config.mcpServers.memory.command, 'npx');
    assert.deepStrictEqual(config.mcpServers.memory.args, ['-y', '@modelcontextprotocol/server-memory']);
  });

  it('removes a server', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-cmd-'));
    const file = path.join(dir, 'mcp.json');
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { a: { command: 'x' } } }));
    const program = new Command();
    registerMcpCommand(program, file);
    await captureLogs(() => program.parseAsync(['node', 'venice', 'mcp', 'remove', 'a']));
    const config = JSON.parse(fs.readFileSync(file, 'utf-8'));
    assert.strictEqual(Object.keys(config.mcpServers).length, 0);
  });

  it('disables and enables a server', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-cmd-'));
    const file = path.join(dir, 'mcp.json');
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { a: { command: 'x' } } }));
    const program = new Command();
    registerMcpCommand(program, file);
    await captureLogs(() => program.parseAsync(['node', 'venice', 'mcp', 'disable', 'a']));
    let config = JSON.parse(fs.readFileSync(file, 'utf-8'));
    assert.strictEqual(config.mcpServers.a.disabled, true);
    await captureLogs(() => program.parseAsync(['node', 'venice', 'mcp', 'enable', 'a']));
    config = JSON.parse(fs.readFileSync(file, 'utf-8'));
    assert.strictEqual(config.mcpServers.a.disabled, false);
  });

  it('inspects a server while masking env values', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-cmd-'));
    const file = path.join(dir, 'mcp.json');
    fs.writeFileSync(file, JSON.stringify({ mcpServers: { a: { command: 'x', env: { SECRET: 'shhh' } } } }));
    const program = new Command();
    registerMcpCommand(program, file);
    const { stdout } = await captureLogs(() => program.parseAsync(['node', 'venice', 'mcp', 'inspect', 'a']));
    assert.ok(stdout.includes('SECRET'));
    assert.ok(stdout.includes('***'));
    assert.ok(!stdout.includes('shhh'));
  });
});

describe('mcp mutating commands and version probe (CLI)', () => {
  it('refuses to overwrite a malformed config on add', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-mutate-'));
    const dir = path.join(homeDir, '.venice');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'mcp.json');
    fs.writeFileSync(file, '{ not valid json');

    const result = runCli(['mcp', 'add', 'memory', '--command', 'npx'], homeDir);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}${result.stdout}`, /MCP config error/);
    assert.strictEqual(fs.readFileSync(file, 'utf-8'), '{ not valid json');
  });

  it('probes a server version and capabilities', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-version-'));
    const dir = path.join(homeDir, '.venice');
    fs.mkdirSync(dir, { recursive: true });
    const serverPath = path.join(process.cwd(), 'src', 'mcp', 'test-server.js');
    const file = path.join(dir, 'mcp.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ mcpServers: { fake: { command: 'node', args: [serverPath] } } })
    );

    const result = runCli(['mcp', 'version', 'fake'], homeDir);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(parsed.name, 'fake');
    assert.strictEqual(parsed.protocolVersion, '2024-11-05');
    assert.strictEqual(parsed.supported, true);
  });
});
