import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { shellTool, buildShellEnv, BoundedTextBuffer } from './execute.js';
import type { RiskLevel } from '../../agent/permissions.js';

describe('shell tool', () => {
  const context = (root: string) => ({
    workspaceRoot: root,
    sessionId: 's1',
    objective: 'test',
    runtimeState: {} as any,
  });

  it('does not describe itself as filesystem-sandboxed (VC-KIMI-056)', () => {
    assert.ok(!/inside the workspace/i.test(shellTool.description), 'description must not imply a sandbox');
    assert.match(shellTool.description, /not filesystem-sandboxed/);
    assert.match(shellTool.description, /OS account privileges/);
  });

  it('runs a successful command', async () => {
    const result = await shellTool.execute({ command: 'echo hello' }, context(os.tmpdir()));
    assert.strictEqual(result.ok, true);
    const data = result.data as { exitCode: number; stdout: string };
    assert.strictEqual(data.exitCode, 0);
    assert.ok(data.stdout.includes('hello'));
  });

  it('captures failure exit code', async () => {
    const result = await shellTool.execute({ command: 'exit 7' }, context(os.tmpdir()));
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data?.exitCode, 7);
  });

  it('times out long-running commands', async () => {
    const result = await shellTool.execute({ command: 'sleep 10', timeoutMs: 100 }, context(os.tmpdir()));
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data?.timedOut, true);
    assert.strictEqual(result.data?.cancelled, false);
  });

  it('cancels the process tree when the abort signal fires (VCL-058)', { skip: process.platform === 'win32' }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'venice-shell-abort-'));
    const pidFile = path.join(root, 'grandchild.pid');
    const controller = new AbortController();
    try {
      const run = shellTool.execute({
        command: `bash -c '(sleep 30) & echo $! > ${pidFile}; sleep 30'`,
        timeoutMs: 60000,
      }, { ...context(root), signal: controller.signal });

      // Let the grandchild spawn, then abort the turn signal.
      await new Promise((r) => setTimeout(r, 200));
      controller.abort();

      const result = await run;
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.data?.cancelled, true);
      assert.strictEqual(result.data?.timedOut, false);

      // Give the SIGTERM -> SIGKILL escalation time to reap the grandchild.
      await new Promise((r) => setTimeout(r, 400));
      const pid = Number.parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
      assert.ok(Number.isInteger(pid) && pid > 0, 'grandchild pid was captured');
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
      }
      assert.strictEqual(alive, false, 'backgrounded grandchild must be killed on abort');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('kills the whole descendant tree on timeout (VC-KIMI-055)', { skip: process.platform === 'win32' }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'venice-shell-tree-'));
    const pidFile = path.join(root, 'grandchild.pid');
    try {
      const result = await shellTool.execute({
        command: `bash -c '(sleep 30) & echo $! > ${pidFile}; sleep 30'`,
        timeoutMs: 150,
      }, context(root));
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.data?.timedOut, true);

      // Give the graceful SIGTERM -> SIGKILL escalation time to reap the
      // backgrounded grandchild.
      await new Promise((r) => setTimeout(r, 400));
      const pid = Number.parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
      assert.ok(Number.isInteger(pid) && pid > 0, 'grandchild pid was captured');
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
      }
      assert.strictEqual(alive, false, 'backgrounded grandchild must be killed with the tree');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('shell risk classification (VC-KIMI-057)', () => {
  const risk = (command: string) =>
    (shellTool.risk as (input: unknown) => RiskLevel)({ command });

  it('classifies ordinary local commands as execute', () => {
    assert.strictEqual(risk('echo hi'), 'execute');
    assert.strictEqual(risk('npm test'), 'execute');
    assert.strictEqual(risk('git status'), 'execute');
  });

  it('classifies destructive commands as destructive', () => {
    assert.strictEqual(risk('rm -rf /tmp/cache'), 'destructive');
    assert.strictEqual(risk('mkfs.ext4 /dev/sda1'), 'destructive');
  });

  it('classifies network and external side effects', () => {
    assert.strictEqual(risk('curl https://example.com'), 'external_side_effect');
    assert.strictEqual(risk('git push origin main'), 'external_side_effect');
    assert.strictEqual(risk('npm publish'), 'external_side_effect');
    assert.strictEqual(risk('ssh deploy@host'), 'external_side_effect');
    assert.strictEqual(risk('sudo apt update'), 'external_side_effect');
  });
});

describe('BoundedTextBuffer (VC-KIMI-019)', () => {
  it('returns small output unchanged', () => {
    const buffer = new BoundedTextBuffer();
    buffer.append('hello world');
    assert.strictEqual(buffer.isTruncated, false);
    assert.strictEqual(buffer.toString(), 'hello world');
  });

  it('keeps a bounded head plus tail and marks truncation', () => {
    const buffer = new BoundedTextBuffer();
    buffer.append('a'.repeat(60000));
    assert.strictEqual(buffer.isTruncated, true);
    const text = buffer.toString();
    assert.ok(text.includes('[output truncated'));
    // head is capped at 50000 chars
    assert.ok(text.startsWith('a'.repeat(50000)));
    // tail holds the final overflow characters
    assert.ok(text.endsWith('a'.repeat(5000)));
    // total stays far below the full input size
    assert.ok(text.length < 60000);
  });

  it('accumulates across many chunks without unbounded growth', () => {
    const buffer = new BoundedTextBuffer();
    for (let i = 0; i < 1000; i++) {
      buffer.append('chunk-' + i + '\n');
    }
    const text = buffer.toString();
    assert.ok(text.length < 60000);
  });
});

describe('buildShellEnv', () => {
  it('does not inherit arbitrary secrets from process.env', () => {
    process.env.VENICE_API_KEY = 'super-secret-123';
    process.env.GITHUB_TOKEN = 'ghp_super_secret';
    const env = buildShellEnv('/tmp/workspace');
    assert.strictEqual(env.VENICE_API_KEY, undefined, 'VENICE_API_KEY should not leak');
    assert.strictEqual(env.GITHUB_TOKEN, undefined, 'GITHUB_TOKEN should not leak');
    assert.strictEqual(env.PWD, '/tmp/workspace');
    assert.ok(env.PATH, 'PATH should be preserved');
    delete process.env.VENICE_API_KEY;
    delete process.env.GITHUB_TOKEN;
  });
});
