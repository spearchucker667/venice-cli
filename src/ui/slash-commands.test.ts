import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseSlashCommand, SLASH_COMMANDS } from './slash-commands.js';

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

  it('includes help in the command list', () => {
    assert.ok(SLASH_COMMANDS.includes('help'));
    assert.ok(SLASH_COMMANDS.includes('quit'));
  });
});
