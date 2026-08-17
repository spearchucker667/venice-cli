import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  buildReadOnlySubagentObjective,
  buildSubagentObjective,
  collectSubagentFilesInspected,
  normalizeSubagentKind,
  normalizeSubagentMaxTurns,
  normalizeSubagentMode,
  parseSubagentReport,
  SUBAGENT_DEFAULT_MAX_TURNS,
  SUBAGENT_MAX_TURNS_LIMIT,
} from './subagents.js';
import type { ToolInvocation } from './types.js';

describe('subagent helpers', () => {
  it('normalizes kind and max turns', () => {
    assert.strictEqual(normalizeSubagentKind('review'), 'review');
    assert.strictEqual(normalizeSubagentKind('unknown'), 'general');
    assert.strictEqual(normalizeSubagentMode(undefined), 'read-only');
    assert.strictEqual(normalizeSubagentMode('write'), 'write');
    assert.strictEqual(normalizeSubagentMaxTurns(undefined), SUBAGENT_DEFAULT_MAX_TURNS);
    assert.strictEqual(normalizeSubagentMaxTurns(0), 1);
    assert.strictEqual(normalizeSubagentMaxTurns(999), SUBAGENT_MAX_TURNS_LIMIT);
  });

  it('builds a shell-free write objective contract', () => {
    const objective = buildSubagentObjective('Update auth flow', 'general', 'write');
    assert.ok(objective.includes('write general subagent'));
    assert.ok(objective.includes('edit files inside the workspace'));
    assert.ok(objective.includes('cannot run shell commands'));
  });

  it('builds a read-only objective contract', () => {
    const objective = buildReadOnlySubagentObjective('Inspect auth flow', 'research');
    assert.ok(objective.includes('read-only research subagent'));
    assert.ok(objective.includes('"findings"'));
    assert.ok(objective.includes('Inspect auth flow'));
  });

  it('parses structured JSON report', () => {
    const output = [
      '```json',
      JSON.stringify(
        {
          summary: 'Found two issues.',
          findings: [
            { severity: 'high', file: 'src/a.ts', line: 12, description: 'Bug A' },
            { description: 'Bug B' },
          ],
          recommendations: ['Fix A', 'Add tests'],
        },
        null,
        2
      ),
      '```',
    ].join('\n');

    const parsed = parseSubagentReport(output);
    assert.strictEqual(parsed.summary, 'Found two issues.');
    assert.strictEqual(parsed.findings.length, 2);
    assert.strictEqual(parsed.findings[0].file, 'src/a.ts');
    assert.deepStrictEqual(parsed.recommendations, ['Fix A', 'Add tests']);
  });

  it('falls back to narrative summary when JSON is missing', () => {
    const parsed = parseSubagentReport('Investigated auth and found no issues.');
    assert.strictEqual(parsed.summary, 'Investigated auth and found no issues.');
    assert.deepStrictEqual(parsed.findings, []);
  });

  it('collects inspected files from read/search tool history', () => {
    const history: ToolInvocation[] = [
      {
        id: '1',
        toolName: 'read_file',
        input: { path: 'src/a.ts' },
        result: { ok: true, data: 'x', metadata: { inspectedFiles: ['src/a.ts'] } },
        approved: true,
        durationMs: 1,
        timestamp: new Date().toISOString(),
      },
      {
        id: '2',
        toolName: 'read_many_files',
        input: { paths: ['src/b.ts', 'src/c.ts'] },
        result: { ok: true, data: {}, metadata: { inspectedFiles: ['src/b.ts', 'src/c.ts'] } },
        approved: true,
        durationMs: 1,
        timestamp: new Date().toISOString(),
      },
      {
        id: '3',
        toolName: 'grep',
        input: { pattern: 'foo' },
        result: { ok: true, data: [{ file: 'src/c.ts', line: 2, text: 'foo' }], metadata: { inspectedFiles: ['src/c.ts'] } },
        approved: true,
        durationMs: 1,
        timestamp: new Date().toISOString(),
      },
    ];

    const files = collectSubagentFilesInspected(history);
    assert.deepStrictEqual(files, ['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });
});
