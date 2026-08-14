import assert from 'node:assert/strict';
import test from 'node:test';
import { continueConversationError } from './chat.js';

const mixError = /across plaintext and E2EE\/TEE sessions/;

test('continueConversationError rejects E2EE/plain mixing', () => {
  assert.match(
    continueConversationError(
      { model: 'e2ee-qwen3-5-122b-a10b', privacy: 'e2ee' },
      { model: 'kimi-k2-5', privacy: 'plain' }
    ) || '',
    mixError
  );
  assert.match(
    continueConversationError(
      { model: 'kimi-k2-5', privacy: 'plain' },
      { model: 'e2ee-qwen3-5-122b-a10b', privacy: 'e2ee' }
    ) || '',
    mixError
  );
});

test('continueConversationError rejects E2EE model switches', () => {
  assert.match(
    continueConversationError(
      { model: 'e2ee-qwen3-5-122b-a10b', privacy: 'e2ee' },
      { model: 'e2ee-other', privacy: 'e2ee' }
    ) || '',
    /different model/
  );
});

test('continueConversationError allows matching plain sessions', () => {
  assert.equal(
    continueConversationError(
      { model: 'kimi-k2-5', privacy: 'plain' },
      { model: 'zai-org-glm-4.7', privacy: 'plain' }
    ),
    undefined
  );
});

test('continueConversationError rejects untagged private-model history into plaintext', () => {
  assert.match(
    continueConversationError(
      { model: 'e2ee-qwen3-5-122b-a10b' },
      { model: 'kimi-k2-5', privacy: 'plain' }
    ) || '',
    mixError
  );
  assert.match(
    continueConversationError(
      { model: 'tee-qwen3-5-122b-a10b' },
      { model: 'kimi-k2-5', privacy: 'plain' }
    ) || '',
    mixError
  );
});

test('continueConversationError rejects untagged plaintext history into E2EE/TEE', () => {
  assert.match(
    continueConversationError(
      { model: 'kimi-k2-5' },
      { model: 'e2ee-qwen3-5-122b-a10b', privacy: 'e2ee' }
    ) || '',
    mixError
  );
});

test('continueConversationError allows untagged private-model history into the same model', () => {
  assert.equal(
    continueConversationError(
      { model: 'e2ee-qwen3-5-122b-a10b' },
      { model: 'e2ee-qwen3-5-122b-a10b', privacy: 'tee' }
    ),
    undefined
  );
});

test('continueConversationError rejects plain-tagged private-model history into another plain model', () => {
  assert.match(
    continueConversationError(
      { model: 'e2ee-qwen3-5-122b-a10b', privacy: 'plain' },
      { model: 'kimi-k2-5', privacy: 'plain' }
    ) || '',
    mixError
  );
});
