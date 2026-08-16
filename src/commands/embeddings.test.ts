import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { registerEmbeddingsCommand } from './embeddings.js';

const cliPath = fileURLToPath(new URL('../index.js', import.meta.url));

function runCli(args: string[], homeDir: string) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      APPDATA: homeDir,
      LOCALAPPDATA: homeDir,
      NO_COLOR: '1',
      VENICE_API_KEY: 'test-key',
    },
  });
}

test('embeddings accepts omitted text for stdin input', () => {
  const program = new Command();
  registerEmbeddingsCommand(program);

  const command = program.commands.find((candidate) => candidate.name() === 'embeddings');
  const textArgument = command?.registeredArguments[0];

  assert.ok(textArgument);
  assert.equal(textArgument.required, false);
  assert.equal(textArgument.variadic, true);
});

test('embeddings rejects non-integer dimensions before calling the API', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'venice-embeddings-test-'));
  try {
    const result = runCli(['embeddings', 'hello', '--dimensions', 'abc'], homeDir);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}${result.stdout}`, /--dimensions must be a positive integer/);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test('embeddings rejects unknown encoding formats before calling the API', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'venice-embeddings-test-'));
  try {
    const result = runCli(['embeddings', 'hello', '--encoding-format', 'xml'], homeDir);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}${result.stdout}`, /--encoding-format must be one of: float, base64/);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});
