import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Command } from 'commander';
import { registerMcpCommand } from './mcp.js';

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
