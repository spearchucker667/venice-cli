import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { readFileTool } from './read.js';
import { readManyFilesTool } from './read-many.js';
import { listDirectoryTool } from './list.js';
import { globTool } from './glob.js';
import { writeFileTool } from './write.js';
import { editFileTool } from './edit.js';
import { applyPatchTool } from './patch.js';
import type { CheckpointManager } from '../../agent/checkpoints.js';

describe('filesystem tools', () => {
  let tmp: string;

  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-fs-test-')));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'app.ts'), 'export const x = 1;\n');
    fs.writeFileSync(path.join(tmp, 'README.md'), '# Hello\n');
  });

  const recorded: Array<{ operation: string; relativePath: string; originalContent: string | null; newContent: string | null }> = [];

  const fakeCheckpointManager = {
    record(entry: { operation: string; relativePath: string; originalContent: string | null; newContent: string | null }) {
      recorded.push(entry);
    },
  } as unknown as CheckpointManager;

  const context = (withManager = false) => ({
    workspaceRoot: tmp,
    sessionId: 's1',
    objective: 'test',
    runtimeState: {} as any,
    checkpointManager: withManager ? fakeCheckpointManager : undefined,
  });

  it('read_file returns file content', async () => {
    const result = await readFileTool.execute({ path: 'src/app.ts' }, context());
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data, 'export const x = 1;\n');
  });

  it('read_file rejects traversal', async () => {
    const result = await readFileTool.execute({ path: '../secret' }, context());
    assert.strictEqual(result.ok, false);
    assert.ok(result.error?.message.includes('outside workspace'));
  });

  it('read_many_files returns contents', async () => {
    const result = await readManyFilesTool.execute({ paths: ['src/app.ts', 'README.md'] }, context());
    assert.strictEqual(result.ok, true);
    assert.strictEqual((result.data as Record<string, string>)['src/app.ts'], 'export const x = 1;\n');
  });

  it('list_directory returns entries', async () => {
    const result = await listDirectoryTool.execute({ path: 'src' }, context());
    assert.strictEqual(result.ok, true);
    assert.ok((result.data as string[]).includes('f app.ts'));
  });

  it('glob finds matching files', async () => {
    const result = await globTool.execute({ pattern: '**/*.ts' }, context());
    assert.strictEqual(result.ok, true);
    assert.ok((result.data as string[]).includes('src/app.ts'));
  });

  it('write_file creates a file', async () => {
    const result = await writeFileTool.execute({ path: 'new.ts', content: 'const x = 1;\n' }, context(true));
    assert.strictEqual(result.ok, true);
    assert.strictEqual(fs.readFileSync(path.join(tmp, 'new.ts'), 'utf-8'), 'const x = 1;\n');
    const record = recorded.find((r) => r.operation === 'write_file' && r.relativePath === 'new.ts');
    assert.ok(record);
    assert.strictEqual(record?.originalContent, null);
    assert.strictEqual(record?.newContent, 'const x = 1;\n');
  });

  it('edit_file replaces old content', async () => {
    fs.writeFileSync(path.join(tmp, 'edit.ts'), 'old\n');
    const result = await editFileTool.execute({ path: 'edit.ts', oldString: 'old', newString: 'new' }, context(true));
    assert.strictEqual(result.ok, true);
    assert.strictEqual(fs.readFileSync(path.join(tmp, 'edit.ts'), 'utf-8'), 'new\n');
    const record = recorded.find((r) => r.operation === 'edit_file' && r.relativePath === 'edit.ts');
    assert.ok(record);
    assert.strictEqual(record?.originalContent, 'old\n');
    assert.strictEqual(record?.newContent, 'new\n');
  });

  it('edit_file detects stale content', async () => {
    fs.writeFileSync(path.join(tmp, 'stale.ts'), 'changed\n');
    const result = await editFileTool.execute({ path: 'stale.ts', oldString: 'old', newString: 'new' }, context());
    assert.strictEqual(result.ok, false);
    assert.ok(result.error?.message.includes('stale'));
  });

  it('apply_patch applies a unified diff', async () => {
    fs.writeFileSync(path.join(tmp, 'patch.ts'), 'a\nb\nc\n');
    const patch = `--- patch.ts\n+++ patch.ts\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n`;
    const result = await applyPatchTool.execute({ path: 'patch.ts', patch }, context(true));
    assert.strictEqual(result.ok, true);
    assert.strictEqual(fs.readFileSync(path.join(tmp, 'patch.ts'), 'utf-8'), 'a\nB\nc\n');
    const record = recorded.find((r) => r.operation === 'apply_patch' && r.relativePath === 'patch.ts');
    assert.ok(record);
    assert.strictEqual(record?.originalContent, 'a\nb\nc\n');
    assert.strictEqual(record?.newContent, 'a\nB\nc\n');
  });
});
