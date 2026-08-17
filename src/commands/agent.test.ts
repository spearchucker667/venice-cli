import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawn, spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as url from 'node:url';
import { Command } from 'commander';
import { registerAgentCommand, resolveApprovalMode, resolveInteractive, terminalExitCode, validateStartupConflicts } from './agent.js';

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

  it('registers --no-brand and defaults brand to on', () => {
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

    const agentCmd = new Command();
    registerAgentCommand(agentCmd);
    const registered = agentCmd.commands.find((c) => c.name() === 'agent');
    assert.ok(registered?.options.some((o) => o.long === '--no-brand'));

    // Default: brand on (commander sets the negated flag's default to true).
    assert.strictEqual(parse(['-p', 'hi'])?.brand, true);
    // Explicit opt-out.
    assert.strictEqual(parse(['-p', 'hi', '--no-brand'])?.brand, false);
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

  it('an explicit --interactive/--no-interactive flag wins over the default', () => {
    assert.strictEqual(resolveInteractive({ prompt: 'x', interactive: true }, tty), true);
    assert.strictEqual(resolveInteractive({ interactive: false }, tty), false);
  });

  it('machine output formats stay headless even with --interactive (VCL-013)', () => {
    assert.strictEqual(resolveInteractive({ outputFormat: 'json', interactive: true }, tty), false);
    assert.strictEqual(resolveInteractive({ json: true, interactive: true }, tty), false);
    assert.strictEqual(resolveInteractive({ outputFormat: 'stream-json', interactive: true }, tty), false);
  });

  it('a non-TTY stdin with no prompt stays headless', () => {
    assert.strictEqual(resolveInteractive({ outputFormat: 'text' }, { stdinTTY: false, stdoutTTY: true }), false);
  });
});

describe('terminalExitCode (VCL-010)', () => {
  it('maps terminal states to distinct exit codes', () => {
    assert.strictEqual(terminalExitCode('complete'), 0);
    assert.strictEqual(terminalExitCode('failed'), 1);
    assert.strictEqual(terminalExitCode('cancelled'), 5);
    assert.strictEqual(terminalExitCode('limit_reached'), 6);
  });

  it('maps unexpected non-terminal states to the generic failure code', () => {
    assert.strictEqual(terminalExitCode('idle'), 1);
    assert.strictEqual(terminalExitCode('thinking'), 1);
  });
});

describe('validateStartupConflicts (VCL-R3-029)', () => {
  const ok = (options: Parameters<typeof validateStartupConflicts>[0], hasStdin = true) =>
    validateStartupConflicts(options, hasStdin);

  it('accepts a plain compatible combination', () => {
    assert.strictEqual(ok({ outputFormat: 'text' }), null);
    assert.strictEqual(ok({ prompt: 'x', outputFormat: 'text' }), null);
    assert.strictEqual(ok({ prompt: 'x', outputFormat: 'json' }), null);
  });

  it('rejects --continue with --session', () => {
    assert.match(ok({ continueFlag: true, session: 'abc', outputFormat: 'text' }) ?? '', /--continue and --session/);
  });

  it('rejects --yolo with --auto', () => {
    assert.match(ok({ yolo: true, auto: true, outputFormat: 'text' }) ?? '', /--yolo and --auto/);
  });

  it('rejects --prompt with --yolo', () => {
    assert.match(ok({ prompt: 'x', yolo: true, outputFormat: 'text' }) ?? '', /--prompt and --yolo/);
  });

  it('rejects --prompt with --auto', () => {
    assert.match(ok({ prompt: 'x', auto: true, outputFormat: 'text' }) ?? '', /--prompt and --auto/);
  });

  it('rejects --prompt with --plan', () => {
    assert.match(ok({ prompt: 'x', plan: true, outputFormat: 'text' }) ?? '', /--prompt and --plan/);
  });

  it('rejects --output-format json without --prompt or piped stdin', () => {
    assert.match(ok({ outputFormat: 'json' }, false) ?? '', /--output-format requires --prompt/);
    assert.match(ok({ outputFormat: 'stream-json' }, false) ?? '', /--output-format requires --prompt/);
    // Piped stdin provides the prompt, so it is allowed.
    assert.strictEqual(ok({ outputFormat: 'json' }, true), null);
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
        const invocation = pseudoTtyScript([process.execPath, cli, 'agent', '-p', 'hi', '--session']);
        const child = spawn(invocation.cmd, invocation.args, {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
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

/**
 * Build a `script`(1) invocation that runs `command` under a pseudo-TTY.
 *
 * BSD/macOS `script` accepts the command as positional args
 * (`script -q /dev/null cmd ...`), while util-linux `script` (Linux CI)
 * requires the command to be passed through `-c`. The command args are
 * shell-quoted so the util-linux `-c` string survives `/bin/sh -c`.
 */
function pseudoTtyScript(command: string[]): { cmd: string; args: string[] } {
  if (process.platform === 'darwin') {
    return { cmd: 'script', args: ['-q', '/dev/null', ...command] };
  }
  const quoted = command.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
  return { cmd: 'script', args: ['-q', '-c', quoted, '/dev/null'] };
}
