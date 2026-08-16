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

  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-git-test-')));
    spawnSync('git', ['init'], { cwd: tmp });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmp });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: tmp });
    fs.writeFileSync(path.join(tmp, 'a.ts'), 'export const x = 1;\n');
    spawnSync('git', ['add', '.'], { cwd: tmp });
    spawnSync('git', ['commit', '-m', 'initial'], { cwd: tmp });
    fs.writeFileSync(path.join(tmp, 'a.ts'), 'export const x = 2;\n');
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

  it('git_log shows commits', async () => {
    const result = await gitLogTool.execute({ limit: 5 }, context());
    assert.strictEqual(result.ok, true);
    assert.ok((result.data as string).includes('initial'));
  });
});
