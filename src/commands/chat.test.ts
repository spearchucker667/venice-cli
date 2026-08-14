import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(new URL('../index.js', import.meta.url));

function runCli(args: string[], homeDir: string) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: homeDir,
      NO_COLOR: '1',
    },
  });
}

test('chat --help lists structured output, reasoning, and X search flags', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'venice-chat-help-'));

  try {
    const result = runCli(['chat', '--help'], homeDir);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--json-schema/);
    assert.match(result.stdout, /--json(?!-)/);
    assert.match(result.stdout, /--reasoning-effort/);
    assert.match(result.stdout, /--x-search/);
    assert.match(result.stdout, /--prompt-cache-key/);
    assert.match(result.stdout, /--prompt-cache-retention/);
    assert.match(result.stdout, /--image/);
    assert.match(result.stdout, /--file/);
    assert.match(result.stdout, /--audio/);
    assert.match(result.stdout, /--video/);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test('chat rejects combining --json and --json-schema', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'venice-chat-json-conflict-'));

  try {
    const schemaPath = join(homeDir, 'schema.json');
    writeFileSync(schemaPath, JSON.stringify({ type: 'object' }));
    const result = runCli(
      ['chat', '--json', '--json-schema', schemaPath, 'extract the fields'],
      homeDir
    );
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /Cannot combine --json and --json-schema/i);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test('chat --json-schema fails before the API when the file is missing', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'venice-chat-schema-'));

  try {
    const result = runCli(
      ['chat', '--json-schema', join(homeDir, 'missing.json'), 'extract the fields'],
      homeDir
    );
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /not found/i);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test('chat --json-schema fails before the API when the file is invalid JSON', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'venice-chat-bad-schema-'));

  try {
    const schemaPath = join(homeDir, 'schema.json');
    writeFileSync(schemaPath, '{not-json');
    const result = runCli(['chat', '--json-schema', schemaPath, 'extract the fields'], homeDir);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /Invalid JSON/i);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test('chat --reasoning-effort rejects unknown values', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'venice-chat-effort-'));

  try {
    const result = runCli(['chat', '--reasoning-effort', 'ludicrous', 'solve this'], homeDir);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /reasoning-effort|ludicrous/i);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test('chat rejects --no-thinking with a non-none reasoning effort', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'venice-chat-conflict-'));

  try {
    const result = runCli(
      ['chat', '--no-thinking', '--reasoning-effort', 'high', 'solve this'],
      homeDir
    );
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /Cannot combine --no-thinking/i);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test('chat --image fails before the API when the file is missing', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'venice-chat-image-'));

  try {
    const result = runCli(
      ['chat', '--image', join(homeDir, 'missing.jpg'), 'what is in this picture?'],
      homeDir
    );
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /Image not found/i);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});
