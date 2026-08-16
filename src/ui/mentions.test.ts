import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { readMentionedFiles, resolveMentions } from './mentions.js';

test('resolveMentions extracts @ mentions correctly', () => {
  const { text, mentions } = resolveMentions('Hello @src/index.ts and @package.json');
  assert.strictEqual(text, 'Hello src/index.ts and package.json');
  assert.deepStrictEqual(mentions, ['src/index.ts', 'package.json']);
});

test('readMentionedFiles securely handles mentions', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'venice-mentions-test-'));
  const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'venice-mentions-external-'));

  try {
    await fs.writeFile(path.join(tmpDir, 'test.txt'), 'hello world');
    await fs.writeFile(path.join(tmpDir, 'binary.bin'), Buffer.from([0x00, 0x01, 0x02]));
    await fs.mkdir(path.join(tmpDir, 'src'));
    await fs.writeFile(path.join(tmpDir, 'src', 'index.ts'), 'console.log("hello");');
    await fs.writeFile(path.join(externalDir, 'secret.txt'), 'secret');
    await fs.symlink(path.join(externalDir, 'secret.txt'), path.join(tmpDir, 'symlink.txt'));

    // Test successful read
    const success = await readMentionedFiles(tmpDir, ['test.txt']);
    assert.match(success, /hello world/);

    // Test directory
    const dir = await readMentionedFiles(tmpDir, ['src']);
    assert.match(dir, /index\.ts/);
    assert.match(dir, /Directory: src/);

    // Test binary file
    const binary = await readMentionedFiles(tmpDir, ['binary.bin']);
    assert.match(binary, /Binary file/);

    // Test missing file
    const missing = await readMentionedFiles(tmpDir, ['missing.txt']);
    assert.match(missing, /File does not exist/);

    // Test external path via symlink escape
    const symlink = await readMentionedFiles(tmpDir, ['symlink.txt']);
    assert.match(symlink, /Path outside workspace/);

    // Test external path via direct traversal
    const relative = path.relative(tmpDir, externalDir);
    const traversal = await readMentionedFiles(tmpDir, [path.join(relative, 'secret.txt')]);
    assert.match(traversal, /Path outside workspace/);

    // Test absolute path
    const absolute = await readMentionedFiles(tmpDir, [path.join(externalDir, 'secret.txt')]);
    assert.match(absolute, /Path outside workspace/);

  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(externalDir, { recursive: true, force: true });
  }
});
