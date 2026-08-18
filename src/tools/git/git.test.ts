import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { gitStatusTool } from './status.js';
import { gitDiffTool } from './diff.js';
import { gitLogTool } from './log.js';

describe('git tools', () => {
  let tmp: string;
  let outside: string;

  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-git-test-')));
    outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-git-outside-')));
    spawnSync('git', ['init'], { cwd: tmp });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmp });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: tmp });
    fs.writeFileSync(path.join(tmp, 'a.ts'), 'export const x = 1;\n');
    fs.writeFileSync(path.join(tmp, '--stat'), 'option-like path: initial\n');
    spawnSync('git', ['add', '--', '.'], { cwd: tmp });
    spawnSync('git', ['commit', '-m', 'initial'], { cwd: tmp });

    // A second commit that does not touch --stat lets the log test distinguish
    // a literal path filter from accidentally interpreting --stat as an option.
    fs.writeFileSync(path.join(tmp, 'second.ts'), 'export const second = true;\n');
    spawnSync('git', ['add', '--', 'second.ts'], { cwd: tmp });
    spawnSync('git', ['commit', '-m', 'second'], { cwd: tmp });

    fs.writeFileSync(path.join(tmp, 'a.ts'), 'export const x = 2;\n');
    fs.writeFileSync(path.join(tmp, '--stat'), 'option-like path: changed\n');
  });

  const context = () => ({
    workspaceRoot: tmp,
    sessionId: 's1',
    objective: 'test',
    runtimeState: {} as any,
  });

  it('git_status reports modified file', async () => {
    const result = await gitStatusTool.execute({}, context());
    assert.strictEqual(result.ok, true);
    const data = result.data as { entries: Array<{ status: string; file: string }> };
    assert.ok(data.entries.some((e) => e.file === 'a.ts'));
  });

  it('git_diff shows working tree changes', async () => {
    const result = await gitDiffTool.execute({}, context());
    assert.strictEqual(result.ok, true);
    assert.ok((result.data as string).includes('export const x = 2;'));
  });

  it('git_diff treats an option-like path as a literal path', async () => {
    const result = await gitDiffTool.execute({ path: '--stat' }, context());
    assert.strictEqual(result.ok, true);
    const output = result.data as string;
    assert.ok(output.includes('option-like path: changed'));
    assert.ok(!output.includes('a.ts'));
  });

  it('git_log shows commits', async () => {
    const result = await gitLogTool.execute({ limit: 5 }, context());
    assert.strictEqual(result.ok, true);
    assert.ok((result.data as string).includes('initial'));
    assert.ok((result.data as string).includes('second'));
  });

  it('git_log treats an option-like path as a literal path filter', async () => {
    const result = await gitLogTool.execute({ limit: 5, path: '--stat' }, context());
    assert.strictEqual(result.ok, true);
    const output = result.data as string;
    assert.ok(output.includes('initial'));
    assert.ok(!output.includes('second'));
  });

  it('rejects cwd outside the approved workspace', async () => {
    const result = await gitStatusTool.execute({ cwd: outside }, context());
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error?.code, 'GIT_STATUS_ERROR');
    assert.match(result.error?.message ?? '', /outside workspace/i);
  });
});
