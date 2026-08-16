import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaffoldVeniceWorkspace } from './init.js';

describe('venice init command', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'venice-init-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('scaffolds .venice directory with config, instructions, and mcp files', () => {
    const result = scaffoldVeniceWorkspace(tempDir);
    assert.strictEqual(result.workspaceRoot, tempDir);
    assert.strictEqual(result.createdFiles.length, 3);
    assert.strictEqual(result.skippedFiles.length, 0);

    const configPath = join(tempDir, '.venice', 'config.json');
    const instructionsPath = join(tempDir, '.venice', 'instructions.md');
    const mcpPath = join(tempDir, '.venice', 'mcp.json');
    const skillsDir = join(tempDir, '.venice', 'skills');

    assert.ok(existsSync(configPath));
    assert.ok(existsSync(instructionsPath));
    assert.ok(existsSync(mcpPath));
    assert.ok(existsSync(skillsDir));

    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    assert.strictEqual(config.agent.approvalMode, 'suggest');
  });

  it('preserves existing files unless force option is specified', () => {
    // First run creates files
    scaffoldVeniceWorkspace(tempDir);

    // Second run should skip
    const secondResult = scaffoldVeniceWorkspace(tempDir);
    assert.strictEqual(secondResult.createdFiles.length, 0);
    assert.strictEqual(secondResult.skippedFiles.length, 3);

    // Force run should overwrite
    const forceResult = scaffoldVeniceWorkspace(tempDir, { force: true });
    assert.strictEqual(forceResult.createdFiles.length, 3);
    assert.strictEqual(forceResult.skippedFiles.length, 0);
  });
});
