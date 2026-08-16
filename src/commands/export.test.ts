import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Command } from 'commander';
import { registerExportCommand } from './export.js';
import { SessionManager } from '../agent/sessions.js';

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
});
