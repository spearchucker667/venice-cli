import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CheckpointManager } from './checkpoints.js';

describe('CheckpointManager', () => {
  let tmp: string;
  let workspace: string;
  let manager: CheckpointManager;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-test-'));
    workspace = path.join(tmp, 'workspace');
    fs.mkdirSync(workspace, { recursive: true });
    manager = new CheckpointManager('session-1', workspace, path.join(tmp, 'sessions'));
  });

  it('records and undoes a file edit', async () => {
    const file = path.join(workspace, 'a.txt');
    fs.writeFileSync(file, 'hello');
    manager.record({
      operation: 'edit_file',
      relativePath: 'a.txt',
      originalContent: 'hello',
      newContent: 'world',
    });
    const result = await manager.undo();
    assert.strictEqual(result.ok, true);
    assert.strictEqual(fs.readFileSync(file, 'utf-8'), 'hello');
  });

  it('redoes an undone edit', async () => {
    const result = await manager.redo();
    assert.strictEqual(result.ok, true);
    assert.strictEqual(fs.readFileSync(path.join(workspace, 'a.txt'), 'utf-8'), 'world');
  });

  it('deletes a file on undo when it was created by write_file', async () => {
    const file = path.join(workspace, 'new.txt');
    fs.writeFileSync(file, 'created');
    manager.record({
      operation: 'write_file',
      relativePath: 'new.txt',
      originalContent: null,
      newContent: 'created',
    });
    await manager.undo();
    assert.strictEqual(fs.existsSync(file), false);
  });

  it('lists checkpoints', () => {
    const list = manager.list();
    assert.strictEqual(list.length, 2);
    assert.ok(list[0].description?.includes('edit_file'));
  });

  it('reports state', () => {
    const state = manager.state();
    assert.strictEqual(state.count, 2);
    assert.strictEqual(state.index, 0);
    assert.strictEqual(state.canUndo, true);
    assert.strictEqual(state.canRedo, true);
  });

  it('does nothing when undo/redo is unavailable', async () => {
    const emptyManager = new CheckpointManager('session-empty', workspace, path.join(tmp, 'sessions'));
    const undo = await emptyManager.undo();
    assert.strictEqual(undo.ok, false);
    const redo = await emptyManager.redo();
    assert.strictEqual(redo.ok, false);
  });

  it('loads checkpoint history from disk', () => {
    const reloaded = new CheckpointManager('session-1', workspace, path.join(tmp, 'sessions'));
    const state = reloaded.state();
    assert.strictEqual(state.count, 2);
    assert.strictEqual(state.index, 0);
  });
});
