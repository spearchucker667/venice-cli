import assert from 'node:assert/strict';
import test from 'node:test';
import { isLegacyLocalCharacter, restoreCharacterSlug } from './chat.js';

test('isLegacyLocalCharacter only matches the old built-in personas', () => {
  assert.equal(isLegacyLocalCharacter('pirate'), true);
  assert.equal(isLegacyLocalCharacter('Wizard'), true);
  assert.equal(isLegacyLocalCharacter('alan-watts'), false);
  assert.equal(isLegacyLocalCharacter(undefined), false);
});

test('restoreCharacterSlug keeps catalog slugs that collide with old persona names', () => {
  assert.equal(
    restoreCharacterSlug({ character: 'poet', messages: [{ role: 'user' }] }),
    'poet'
  );
  assert.equal(
    restoreCharacterSlug({ character: 'alan-watts', messages: [{ role: 'user' }] }),
    'alan-watts'
  );
});

test('restoreCharacterSlug skips old local personas that already have a system prompt', () => {
  assert.equal(
    restoreCharacterSlug({
      character: 'pirate',
      messages: [{ role: 'system' }, { role: 'user' }],
    }),
    undefined
  );
});
