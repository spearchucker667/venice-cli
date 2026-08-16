import { describe, it } from 'node:test';
import assert from 'node:assert';
import { checkpointListTool } from './checkpoint-list.js';
import { checkpointUndoTool } from './checkpoint-undo.js';
import { checkpointRedoTool } from './checkpoint-redo.js';
import type { CheckpointManager } from '../../agent/checkpoints.js';

function fakeManager(overrides?: Partial<CheckpointManager>) {
  return {
    list: () => [{ operation: 'edit_file', relativePath: 'a.txt' }],
    undo: async () => ({ ok: true, restored: 'a.txt', operation: 'undo' as const }),
    redo: async () => ({ ok: true, restored: 'a.txt', operation: 'redo' as const }),
    ...overrides,
  } as unknown as CheckpointManager;
}

const context = (manager?: CheckpointManager) => ({
  workspaceRoot: '/tmp',
  sessionId: 's',
  objective: 'o',
  runtimeState: {} as any,
  checkpointManager: manager,
});

describe('checkpoint meta tools', () => {
  it('checkpoint_list returns checkpoints', async () => {
    const result = await checkpointListTool.execute({}, context(fakeManager()));
    assert.strictEqual(result.ok, true);
    assert.ok(Array.isArray(result.data));
  });

  it('checkpoint_undo delegates to manager', async () => {
    const result = await checkpointUndoTool.execute({}, context(fakeManager()));
    assert.strictEqual(result.ok, true);
    assert.strictEqual((result.data as { restored: string }).restored, 'a.txt');
  });

  it('checkpoint_undo fails when no manager', async () => {
    const result = await checkpointUndoTool.execute({}, context());
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error?.code, 'NO_CHECKPOINT_MANAGER');
  });

  it('checkpoint_redo delegates to manager', async () => {
    const result = await checkpointRedoTool.execute({}, context(fakeManager()));
    assert.strictEqual(result.ok, true);
    assert.strictEqual((result.data as { restored: string }).restored, 'a.txt');
  });

  it('checkpoint_redo fails when nothing to redo', async () => {
    const result = await checkpointRedoTool.execute({}, context(fakeManager({ redo: async () => ({ ok: false, restored: '', operation: 'redo' as const }) })));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error?.code, 'REDO_FAILED');
  });
});
