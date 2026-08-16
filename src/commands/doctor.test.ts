import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(new URL('../index.js', import.meta.url));

function runCli(args: string[], opts: { homeDir: string; cwd?: string }) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    cwd: opts.cwd,
    env: {
      ...process.env,
      HOME: opts.homeDir,
      USERPROFILE: opts.homeDir,
      APPDATA: opts.homeDir,
      LOCALAPPDATA: opts.homeDir,
      NO_COLOR: '1',
    },
  });
}

test('doctor config passes with no config file', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'venice-doctor-config-'));
  try {
    const result = runCli(['doctor', 'config'], { homeDir });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No config file/);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test('doctor config reports malformed JSON as an error', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'venice-doctor-config-'));
  try {
    mkdirSync(join(homeDir, '.venice'), { recursive: true });
    writeFileSync(join(homeDir, '.venice', 'config.json'), '{ not valid json');
    const result = runCli(['doctor', 'config'], { homeDir });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /malformed JSON/);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test('doctor config rejects a symbolic-link config file', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'venice-doctor-config-'));
  try {
    mkdirSync(join(homeDir, '.venice'), { recursive: true });
    const target = join(homeDir, 'target.json');
    writeFileSync(target, '{"api_key":"x"}');
    symlinkSync(target, join(homeDir, '.venice', 'config.json'));
    const result = runCli(['doctor', 'config'], { homeDir });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /symbolic link/);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test('doctor api sees the pinned spec and api:contract script in a checkout', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'venice-doctor-api-'));
  try {
    const result = runCli(['doctor', 'api'], { homeDir });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /api:contract script is wired/);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
  }
});

test('doctor security flags an untrusted project MCP config', () => {
  const homeDir = mkdtempSync(join(tmpdir(), 'venice-doctor-security-'));
  const workspace = mkdtempSync(join(tmpdir(), 'venice-doctor-ws-'));
  try {
    mkdirSync(join(workspace, '.venice'), { recursive: true });
    writeFileSync(
      join(workspace, '.venice', 'mcp.json'),
      JSON.stringify({ mcpServers: { fake: { command: 'echo', args: ['hi'] } } })
    );
    const result = runCli(['doctor', 'security'], { homeDir, cwd: workspace });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Untrusted project MCP config/);
  } finally {
    rmSync(homeDir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

test(
  'doctor sessions reports unsafe directory permissions as an error',
  { skip: process.platform === 'win32' },
  () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'venice-doctor-sessions-'));
    try {
      const sessionsRoot = join(homeDir, '.venice', 'sessions');
      mkdirSync(sessionsRoot, { recursive: true, mode: 0o755 });
      const result = runCli(['doctor', 'sessions'], { homeDir });
      assert.equal(result.status, 1);
      assert.match(result.stdout, /permissions.*expected 700/);
      rmSync(sessionsRoot, { recursive: true, force: true });
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  }
);
