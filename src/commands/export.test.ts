import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Command } from 'commander';
import { registerExportCommand } from './export.js';
import { SessionManager } from '../agent/sessions.js';
import { SessionImportService } from '../agent/session-import.js';
import type { StoredSession } from '../agent/sessions.js';

describe('registerExportCommand', () => {
  it('exports the most recent session when no id is given', () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-export-test-')));
    const manager = new SessionManager();
    try {
      const state = {
        sessionId: 's1',
        workspaceRoot: tmp,
        workspace: { primaryRoot: tmp, additionalRoots: [] },
        model: 'test',
        objective: 'export test',
        status: 'complete' as const,
        mode: { inputMode: 'agent' as const, operatingMode: 'agent' as const, permissionMode: 'suggest' as const },
        messages: [{ role: 'user' as const, content: 'hello' }],
        todos: [], relevantFiles: [], changedFiles: [], toolHistory: [], skillSummaries: [], activeSkills: [],
      };
      manager.save(state, []);

      const program = new Command();
      registerExportCommand(program);
      program.exitOverride();

      const output = path.join(tmp, 'out.md');
      program.parse(['node', 'venice', 'export', '--workspace', tmp, '-o', output]);

      assert.ok(fs.existsSync(output));
      const content = fs.readFileSync(output, 'utf-8');
      assert.ok(content.includes('export test'));
      assert.ok(content.includes('hello'));
    } finally {
      manager.delete('s1');
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('round-trips a session through JSON export and import (VC-KIMI-012)', () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-export-roundtrip-')));
    const manager = new SessionManager();
    try {
      const state = {
        sessionId: 'roundtrip-1',
        workspaceRoot: tmp,
        workspace: { primaryRoot: tmp, additionalRoots: [] },
        model: 'test',
        objective: 'roundtrip objective',
        status: 'complete' as const,
        mode: { inputMode: 'agent' as const, operatingMode: 'agent' as const, permissionMode: 'suggest' as const },
        messages: [
          { role: 'user' as const, content: 'hello' },
          { role: 'assistant' as const, content: 'hi there' },
        ],
        todos: [], relevantFiles: [], changedFiles: [], toolHistory: [], skillSummaries: [], activeSkills: [],
      };
      manager.save(state, [{ type: 'session_started', timestamp: 'x', eventId: 'e1', sessionId: 'roundtrip-1', objective: 'roundtrip objective' }]);

      const program = new Command();
      registerExportCommand(program);
      program.exitOverride();

      const output = path.join(tmp, 'session.json');
      program.parse(['node', 'venice', 'export', 'roundtrip-1', '--workspace', tmp, '--format', 'json', '-o', output]);

      const parsed = JSON.parse(fs.readFileSync(output, 'utf-8')) as StoredSession;
      assert.strictEqual(parsed.sessionId, 'roundtrip-1');
      assert.ok(parsed.state && Array.isArray(parsed.events));

      // Markdown export is human-readable, not importable (work order §12).
      // Use a fresh Command: commander reuses option values across parses.
      const mdProgram = new Command();
      registerExportCommand(mdProgram);
      mdProgram.exitOverride();
      const mdOutput = path.join(tmp, 'session.md');
      mdProgram.parse(['node', 'venice', 'export', 'roundtrip-1', '--workspace', tmp, '-o', mdOutput]);
      assert.ok(fs.readFileSync(mdOutput, 'utf-8').includes('# Session roundtrip-1'));

      // Import the JSON export into a fresh store and verify the state survived.
      const imported = new SessionImportService(new SessionManager(path.join(tmp, 'imported-sessions')))
        .importData(parsed);
      assert.strictEqual(imported.state.objective, 'roundtrip objective');
      assert.strictEqual(imported.state.messages.length, 2);
      assert.strictEqual(imported.events.length, 1);
    } finally {
      manager.delete('roundtrip-1');
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('treats --debug as a JSON debug export', () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-export-debug-')));
    const manager = new SessionManager();
    try {
      const state = {
        sessionId: 'debug-1',
        workspaceRoot: tmp,
        workspace: { primaryRoot: tmp, additionalRoots: [] },
        model: 'test',
        objective: 'debug objective',
        status: 'complete' as const,
        mode: { inputMode: 'agent' as const, operatingMode: 'agent' as const, permissionMode: 'suggest' as const },
        messages: [], todos: [], relevantFiles: [], changedFiles: [], toolHistory: [], skillSummaries: [], activeSkills: [],
      };
      manager.save(state, []);
      const program = new Command();
      registerExportCommand(program);
      program.exitOverride();
      const output = path.join(tmp, 'debug.json');
      program.parse(['node', 'venice', 'export', 'debug-1', '--workspace', tmp, '--debug', '-o', output]);
      const parsed = JSON.parse(fs.readFileSync(output, 'utf-8')) as StoredSession;
      assert.strictEqual(parsed.sessionId, 'debug-1');
    } finally {
      manager.delete('debug-1');
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
