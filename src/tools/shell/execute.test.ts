import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as os from 'node:os';
import { shellTool, buildShellEnv } from './execute.js';
import type { RiskLevel } from '../../agent/permissions.js';

describe('shell tool', () => {
  const context = (root: string) => ({
    workspaceRoot: root,
    sessionId: 's1',
    objective: 'test',
    runtimeState: {} as any,
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
