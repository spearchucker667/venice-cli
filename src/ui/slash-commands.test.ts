import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  parseSlashCommand,
  SLASH_COMMANDS,
  findSlashCommands,
  findSlashCommandDefinition,
  getSlashCommandBase,
  isSlashCommandAvailable,
  isBusyStatus,
} from './slash-commands.js';

describe('parseSlashCommand', () => {
  it('parses /quit', () => {
    const result = parseSlashCommand('/quit');
    assert.deepStrictEqual(result, { command: 'quit', args: '' });
  });

  it('parses command with arguments', () => {
    const result = parseSlashCommand('/model kimi-k2.5');
    assert.deepStrictEqual(result, { command: 'model', args: 'kimi-k2.5' });
  });

  it('ignores leading whitespace', () => {
    const result = parseSlashCommand('  /status');
    assert.deepStrictEqual(result, { command: 'status', args: '' });
  });

  it('returns undefined for plain text', () => {
    const result = parseSlashCommand('hello world');
    assert.strictEqual(result, undefined);
  });

  it('includes help and quit in the command list', () => {
    assert.ok(SLASH_COMMANDS.some((cmd) => cmd.name === 'help'));
    assert.ok(SLASH_COMMANDS.some((cmd) => cmd.name === 'quit'));
  });

  it('lists all slash commands with descriptions and availability', () => {
    assert.ok(SLASH_COMMANDS.length > 10);
    for (const cmd of SLASH_COMMANDS) {
      assert.ok(cmd.name.length > 0);
      assert.ok(cmd.description.length > 0);
      assert.ok(cmd.availability === 'always' || cmd.availability === 'idle');
    }
  });

  it('finds slash commands by name, alias, or description', () => {
    assert.ok(findSlashCommands('/help').some((c) => c.name === 'help'));
    assert.ok(findSlashCommands('/quit').some((c) => c.name === 'quit'));
    assert.ok(findSlashCommands('/toggle').some((c) => c.name.includes('plan')));
    assert.strictEqual(findSlashCommands('help').length, 0);
  });

  it('derives base command names from sub-command definitions', () => {
    assert.strictEqual(getSlashCommandBase('plan'), 'plan');
    assert.strictEqual(getSlashCommandBase('plan view'), 'plan');
    assert.strictEqual(getSlashCommandBase('export-debug-zip'), 'export-debug-zip');
  });

  it('finds the metadata entry for a parsed command token', () => {
    assert.strictEqual(findSlashCommandDefinition('plan')?.name, 'plan');
    assert.strictEqual(findSlashCommandDefinition('compact')?.availability, 'idle');
    assert.strictEqual(findSlashCommandDefinition('does-not-exist'), undefined);
  });

  it('classifies running statuses as busy', () => {
    assert.ok(isBusyStatus('thinking'));
    assert.ok(isBusyStatus('executing_tool'));
    assert.ok(!isBusyStatus('idle'));
    assert.ok(!isBusyStatus('complete'));
  });

  it('enforces idle-only availability metadata (VC-KIMI-046)', () => {
    const compact = findSlashCommandDefinition('compact')!;
    assert.ok(isSlashCommandAvailable(compact, 'idle'));
    assert.ok(!isSlashCommandAvailable(compact, 'thinking'));

    const status = findSlashCommandDefinition('status')!;
    assert.ok(isSlashCommandAvailable(status, 'thinking'));
  });
});
