import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { grepTool, searchFilesWithRegex } from './grep.js';
import { findTool } from './find.js';

describe('search tools', () => {
  let tmp: string;

  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-search-test-')));
    fs.writeFileSync(path.join(tmp, 'a.ts'), 'const foo = 1;\n');
    fs.writeFileSync(path.join(tmp, 'b.ts'), 'const bar = 2;\n');
    fs.writeFileSync(path.join(tmp, '[literal].ts'), 'const literal = true;\n');
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

  it('grep rejects invalid regex syntax cleanly', async () => {
    const result = await grepTool.execute({ pattern: '[', paths: ['.'] }, context());
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error?.code, 'INVALID_PATTERN');
  });

  it('regex matching can be terminated when a pathological pattern stalls', async () => {
    const attackFile = path.join(tmp, 'redos.txt');
    fs.writeFileSync(attackFile, `${'a'.repeat(30_000)}!\n`);

    await assert.rejects(
      () => searchFilesWithRegex(
        [{ absolute: attackFile, file: 'redos.txt' }],
        '^(a+)+$',
        100
      ),
      /exceeded 100ms and was terminated/i
    );
  });

  it('grep does not follow recursive symlinks outside the workspace', async () => {
    if (process.platform === 'win32') return;
    const external = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-search-external-')));
    const secret = path.join(external, 'secret.txt');
    fs.writeFileSync(secret, 'EXTERNAL_SECRET_MARKER\n');
    fs.symlinkSync(secret, path.join(tmp, 'secret-link.txt'));

    const result = await grepTool.execute({ pattern: 'EXTERNAL_SECRET_MARKER', paths: ['.'] }, context());
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.data, []);
  });

  it('find locates files by name', async () => {
    const result = await findTool.execute({ pattern: '*.ts' }, context());
    assert.strictEqual(result.ok, true);
    const files = result.data as string[];
    assert.ok(files.includes('a.ts'));
    assert.ok(files.includes('sub/c.ts'));
  });

  it('find treats regex metacharacters as literal glob characters', async () => {
    const result = await findTool.execute({ pattern: '[literal].ts' }, context());
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.data, ['[literal].ts']);
  });
});
