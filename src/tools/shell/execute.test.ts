import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as os from 'node:os';
import { shellTool } from './execute.js';

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
