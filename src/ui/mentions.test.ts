import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveMentions } from './mentions.js';

describe('resolveMentions', () => {
  it('finds @path mentions', () => {
    const result = resolveMentions('look at @src/app.ts');
    assert.deepStrictEqual(result.mentions, ['src/app.ts']);
    assert.ok(result.text.includes('src/app.ts'));
  });

  it('resolves multiple mentions', () => {
    const result = resolveMentions('@src/a.ts and @src/b.ts');
    assert.deepStrictEqual(result.mentions, ['src/a.ts', 'src/b.ts']);
  });

  it('rejects path traversal in mentions', () => {
    const result = resolveMentions('read @../secret');
    assert.deepStrictEqual(result.mentions, ['secret']);
  });

  it('strips leading slash from absolute mentions', () => {
    const result = resolveMentions('read @/etc/passwd');
    assert.deepStrictEqual(result.mentions, ['etc/passwd']);
  });

  it('returns empty when no mentions', () => {
    const result = resolveMentions('hello');
    assert.deepStrictEqual(result.mentions, []);
  });
});
