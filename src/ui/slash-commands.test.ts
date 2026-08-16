import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseSlashCommand, SLASH_COMMANDS, findSlashCommands } from './slash-commands.js';

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
});
