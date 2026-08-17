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

  it('restores a checkpoint in an additional root, not the primary (VCL-R3-003)', async () => {
    const primary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cp-primary-')));
    const shared = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cp-shared-')));
    // Two roots that both contain src/a.ts with different content.
    fs.mkdirSync(path.join(primary, 'src'), { recursive: true });
    fs.mkdirSync(path.join(shared, 'src'), { recursive: true });
    fs.writeFileSync(path.join(primary, 'src', 'a.ts'), 'primary-version');
    fs.writeFileSync(path.join(shared, 'src', 'a.ts'), 'shared-original');

    const manager = new CheckpointManager(
      'session-multiroot',
      primary,
      path.join(tmp, 'sessions'),
      [shared]
    );
    manager.record({
      operation: 'edit_file',
      relativePath: 'src/a.ts',
      rootId: shared,
      originalContent: 'shared-original',
      newContent: 'shared-edited',
    });

    // Simulate the edit having been applied to the shared root.
    fs.writeFileSync(path.join(shared, 'src', 'a.ts'), 'shared-edited');

    const result = await manager.undo();
    assert.strictEqual(result.ok, true);
    // The additional-root file is restored...
    assert.strictEqual(fs.readFileSync(path.join(shared, 'src', 'a.ts'), 'utf-8'), 'shared-original');
    // ...and the primary-root file with the same relative path is untouched.
    assert.strictEqual(fs.readFileSync(path.join(primary, 'src', 'a.ts'), 'utf-8'), 'primary-version');

    fs.rmSync(primary, { recursive: true, force: true });
    fs.rmSync(shared, { recursive: true, force: true });
  });

  it('rolls back in-memory state when persistence fails (R2-013)', () => {
    // A storage root that is a regular file makes save() throw on mkdirSync.
    const fileRoot = path.join(tmp, 'storage-is-a-file');
    fs.writeFileSync(fileRoot, 'not a directory');
    const failing = new CheckpointManager('session-fail', workspace, fileRoot);
    assert.throws(() =>
      failing.record({
        operation: 'write_file',
        relativePath: 'x.txt',
        originalContent: null,
        newContent: 'x',
      })
    );
    // The surfaced failure must not leave a half-recorded checkpoint in memory.
    assert.strictEqual(failing.state().count, 0);
    assert.strictEqual(failing.state().canUndo, false);
  });

  it('revalidates the target root on undo and refuses stale roots (VCL-R3-003)', async () => {
    const primary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cp-reval-primary-')));
    const removed = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cp-reval-removed-')));
    fs.writeFileSync(path.join(removed, 'a.txt'), 'original');

    // Manager knows only the primary root — the checkpoint references a root
    // that is no longer part of the workspace scope.
    const manager = new CheckpointManager('session-stale-root', primary, path.join(tmp, 'sessions'));
    manager.record({
      operation: 'edit_file',
      relativePath: 'a.txt',
      rootId: removed,
      originalContent: 'original',
      newContent: 'edited',
    });

    const result = await manager.undo();
    assert.strictEqual(result.ok, false);
    assert.match(result.error ?? '', /no longer part of the workspace/);
    // The file in the now-removed root must NOT have been modified.
    assert.strictEqual(fs.readFileSync(path.join(removed, 'a.txt'), 'utf-8'), 'original');

    fs.rmSync(primary, { recursive: true, force: true });
    fs.rmSync(removed, { recursive: true, force: true });
  });
});
