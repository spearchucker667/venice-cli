import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as os from 'node:os';
import { runValidationTool } from './run.js';

describe('run_validation tool', () => {
  const context = (root: string) => ({
    workspaceRoot: root,
    sessionId: 's1',
    objective: 'test',
    runtimeState: {} as any,
  });

  it('runs a successful validation command', async () => {
    const result = await runValidationTool.execute({ command: 'echo passed' }, context(os.tmpdir()));
    assert.strictEqual(result.ok, true);
    const data = result.data as { exitCode: number; stdout: string };
    assert.strictEqual(data.exitCode, 0);
    assert.ok(data.stdout.includes('passed'));
  });

  it('preserves failure exit code', async () => {
    const result = await runValidationTool.execute({ command: 'exit 3' }, context(os.tmpdir()));
    assert.strictEqual(result.ok, true);
    assert.strictEqual((result.data as { exitCode: number }).exitCode, 3);
  });
});
