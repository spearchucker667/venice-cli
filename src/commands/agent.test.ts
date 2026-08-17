import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as url from 'node:url';
import { Command } from 'commander';
import { registerAgentCommand, resolveApprovalMode, resolveInteractive } from './agent.js';

describe('registerAgentCommand', () => {
  it('registers the agent command', () => {
    const program = new Command();
    registerAgentCommand(program);
    const agentCmd = program.commands.find((c) => c.name() === 'agent');
    assert.ok(agentCmd);
  });

  it('registers --no-interactive and --interactive flags', () => {
    const program = new Command();
    registerAgentCommand(program);
    const agentCmd = program.commands.find((c) => c.name() === 'agent');
    assert.ok(agentCmd?.options.some((o) => o.long === '--interactive'));
    assert.ok(agentCmd?.options.some((o) => o.long === '--no-interactive'));
  });

  it('registers --auto and --yolo shorthand flags', () => {
    const program = new Command();
    registerAgentCommand(program);
    const agentCmd = program.commands.find((c) => c.name() === 'agent');
    assert.ok(agentCmd?.options.some((o) => o.long === '--auto'));
    assert.ok(agentCmd?.options.some((o) => o.long === '--yolo'));
  });

  it('registers a repeatable --skills-dir flag', () => {
    const program = new Command();
    registerAgentCommand(program);
    program.exitOverride();
    let capturedOptions: Record<string, unknown> | undefined;
    const agent = program.commands.find((c) => c.name() === 'agent');
    assert.ok(agent);
    agent!.action((options) => { capturedOptions = options; });

    program.parse(['node', 'venice', 'agent', '--skills-dir', '/a', '--skills-dir', '/b', '-p', 'hi']);
    assert.deepStrictEqual(capturedOptions?.skillsDir, ['/a', '/b']);
  });

  it('registers a repeatable --add-dir flag', () => {
    const program = new Command();
    registerAgentCommand(program);
    program.exitOverride();
    let capturedOptions: Record<string, unknown> | undefined;
    const agent = program.commands.find((c) => c.name() === 'agent');
    assert.ok(agent);
    agent!.action((options) => { capturedOptions = options; });

    program.parse(['node', 'venice', 'agent', '--add-dir', '/a', '--add-dir', '/b', '-p', 'hi']);
    assert.deepStrictEqual(capturedOptions?.addDir, ['/a', '/b']);
  });

  it('parses --yolo and --auto as booleans', () => {
    const parse = (args: string[]): Record<string, unknown> | undefined => {
      const program = new Command();
      registerAgentCommand(program);
      program.exitOverride();
      let capturedOptions: Record<string, unknown> | undefined;
      const agent = program.commands.find((c) => c.name() === 'agent');
      assert.ok(agent);
      agent!.action((options) => { capturedOptions = options; });
      program.parse(['node', 'venice', 'agent', ...args]);
      return capturedOptions;
    };

    const yolo = parse(['--yolo', '-p', 'hi']);
    assert.strictEqual(yolo?.yolo, true);
    assert.strictEqual(yolo?.auto, undefined);

    const auto = parse(['--auto', '-p', 'hi']);
    assert.strictEqual(auto?.auto, true);
    assert.strictEqual(auto?.yolo, undefined);
  });
});

describe('resolveApprovalMode', () => {
  it('defaults interactive to suggest and noninteractive to auto-edit', () => {
    assert.equal(resolveApprovalMode(undefined, true), 'suggest');
    assert.equal(resolveApprovalMode(undefined, false), 'auto-edit');
  });

  it('lets an explicit approval mode win in either mode', () => {
    assert.equal(resolveApprovalMode('auto', true), 'auto');
    assert.equal(resolveApprovalMode('yolo', false), 'yolo');
    assert.equal(resolveApprovalMode('suggest', false), 'suggest');
  });
});

describe('resolveInteractive (VCL-R3-007/008)', () => {
  const tty = { stdinTTY: true, stdoutTTY: true };
  const pipe = { stdinTTY: false, stdoutTTY: false };

  it('opens the TUI only for a plain text run on a TTY with no prompt', () => {
    assert.strictEqual(resolveInteractive({ outputFormat: 'text' }, tty), true);
    assert.strictEqual(resolveInteractive({ outputFormat: 'text' }, pipe), false);
  });

  it('-p forces headless even on a TTY (VCL-R3-007)', () => {
    assert.strictEqual(resolveInteractive({ prompt: 'hi', outputFormat: 'text' }, tty), false);
    assert.strictEqual(resolveInteractive({ prompt: '', outputFormat: 'text' }, tty), false);
  });

  it('machine output formats force headless (VCL-R3-008)', () => {
    assert.strictEqual(resolveInteractive({ outputFormat: 'json' }, tty), false);
    assert.strictEqual(resolveInteractive({ json: true }, tty), false);
    assert.strictEqual(resolveInteractive({ outputFormat: 'stream-json' }, tty), false);
    assert.strictEqual(resolveInteractive({ outputFormat: 'stream-json', prompt: 'x' }, tty), false);
  });

  it('an explicit --interactive/--no-interactive flag always wins', () => {
    assert.strictEqual(resolveInteractive({ prompt: 'x', interactive: true }, tty), true);
    assert.strictEqual(resolveInteractive({ outputFormat: 'json', interactive: true }, tty), true);
    assert.strictEqual(resolveInteractive({ interactive: false }, tty), false);
  });

  it('a non-TTY stdin with no prompt stays headless', () => {
    assert.strictEqual(resolveInteractive({ outputFormat: 'text' }, { stdinTTY: false, stdoutTTY: true }), false);
  });
});

describe('headless -p under a pseudo-TTY (VCL-R3-007)', () => {
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const cli = path.resolve(here, '../../dist/index.js');

  it(
    '-p never opens the TUI even when stdin/stdout are TTYs',
    { skip: process.platform === 'win32' || scriptUnavailable() },
    async () => {
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(
          'script',
          ['-q', '/dev/null', process.execPath, cli, 'agent', '-p', 'hi', '--session'],
          { stdio: ['ignore', 'pipe', 'pipe'] }
        );
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += d; });
        child.stderr.on('data', (d) => { stderr += d; });
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error(`pseudo-TTY probe timed out (likely opened the TUI):\n${stdout}\n${stderr}`));
        }, 15000);
        child.on('close', () => {
          clearTimeout(timer);
          resolve(stdout + stderr);
        });
        child.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      // --session with no id is only legal interactively; its rejection
      // message is emitted only by the headless path. If -p opened the TUI,
      // this string would never appear.
      assert.match(output, /--session requires an id in noninteractive mode/);
    }
  );
});

function scriptUnavailable(): boolean {
  try {
    const probe = spawnSync('script', ['--version'], { stdio: 'ignore' });
    return probe.error !== undefined;
  } catch {
    return true;
  }
}
