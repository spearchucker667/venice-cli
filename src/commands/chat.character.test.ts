import assert from 'node:assert/strict';
import test from 'node:test';
import { apiCharacterSlug } from './chat.js';

test('apiCharacterSlug ignores legacy local persona names', () => {
  assert.equal(apiCharacterSlug('pirate'), undefined);
  assert.equal(apiCharacterSlug('Wizard'), undefined);
  assert.equal(apiCharacterSlug('alan-watts'), 'alan-watts');
  assert.equal(apiCharacterSlug(undefined), undefined);
});
