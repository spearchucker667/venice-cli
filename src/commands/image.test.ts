import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Command } from 'commander';
import { registerImageCommand } from './image.js';

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

async function runImageCommand(args: string[]): Promise<string[]> {
  const output: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => output.push(values.join(' '));

  try {
    const program = new Command();
    registerImageCommand(program);
    await program.parseAsync(['node', 'venice', ...args]);
    return output;
  } finally {
    console.log = originalLog;
  }
}

test('upscale JSON returns base64 without files while pretty output writes a file', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;
  const originalCwd = process.cwd();
  const tempDir = mkdtempSync(join(tmpdir(), 'venice-upscale-cli-test-'));
  const inputPath = join(tempDir, 'input.png');
  const ignoredOutputPath = join(tempDir, 'ignored.png');
  const prettyOutputPath = join(tempDir, 'pretty.png');

  writeFileSync(inputPath, PNG_BYTES);
  process.env.VENICE_API_KEY = 'test-key';
  process.chdir(tempDir);
  globalThis.fetch = (async () => new Response(PNG_BYTES, {
    headers: { 'Content-Type': 'image/png' },
  })) as typeof fetch;

  try {
    const jsonOutput = await runImageCommand([
      'upscale',
      inputPath,
      '--format',
      'json',
      '--output',
      ignoredOutputPath,
    ]);
    const parsed = JSON.parse(jsonOutput.join('\n')) as {
      images: Array<{ b64_json: string; content_type: string; bytes: number }>;
    };

    assert.deepEqual(parsed, {
      images: [{
        b64_json: PNG_BYTES.toString('base64'),
        content_type: 'image/png',
        bytes: PNG_BYTES.length,
      }],
    });
    assert.equal(existsSync(ignoredOutputPath), false);
    assert.deepEqual(readdirSync(tempDir), ['input.png']);

    await runImageCommand([
      'upscale',
      inputPath,
      '--format',
      'pretty',
      '--output',
      prettyOutputPath,
    ]);
    assert.equal(readFileSync(prettyOutputPath).equals(PNG_BYTES), true);
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
    if (originalApiKey === undefined) {
      delete process.env.VENICE_API_KEY;
    } else {
      process.env.VENICE_API_KEY = originalApiKey;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});
