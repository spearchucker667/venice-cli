import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { grepTool } from './grep.js';
import { findTool } from './find.js';

describe('search tools', () => {
  let tmp: string;

  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-search-test-')));
    fs.writeFileSync(path.join(tmp, 'a.ts'), 'const foo = 1;\n');
    fs.writeFileSync(path.join(tmp, 'b.ts'), 'const bar = 2;\n');
    fs.mkdirSync(path.join(tmp, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'sub', 'c.ts'), 'const foo = 3;\n');
  });

  const context = () => ({
    workspaceRoot: tmp,
    sessionId: 's1',
    objective: 'test',
    runtimeState: {} as any,
  });

  it('grep finds matching lines', async () => {
    const result = await grepTool.execute({ pattern: 'foo', paths: ['.'] }, context());
    assert.strictEqual(result.ok, true);
    const matches = result.data as Array<{ file: string; line: number; text: string }>;
    assert.strictEqual(matches.length, 2);
  });

  it('find locates files by name', async () => {
    const result = await findTool.execute({ pattern: '*.ts' }, context());
    assert.strictEqual(result.ok, true);
    const files = result.data as string[];
    assert.ok(files.includes('a.ts'));
    assert.ok(files.includes('sub/c.ts'));
  });
});
