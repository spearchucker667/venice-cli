import assert from 'node:assert/strict';
import test from 'node:test';
import { continueConversationError } from './chat.js';

test('continueConversationError rejects E2EE/plain mixing', () => {
  assert.match(
    continueConversationError(
      { model: 'e2ee-qwen3-5-122b-a10b', privacy: 'e2ee' },
      { model: 'kimi-k2-5', privacy: 'plain' }
    ) || '',
    /Cannot continue a e2ee conversation with a plain session/
  );
  assert.match(
    continueConversationError(
      { model: 'kimi-k2-5', privacy: 'plain' },
      { model: 'e2ee-qwen3-5-122b-a10b', privacy: 'e2ee' }
    ) || '',
    /Cannot continue a plain conversation with a e2ee session/
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

test('continueConversationError infers E2EE from legacy history without privacy', () => {
  assert.match(
    continueConversationError(
      { model: 'e2ee-qwen3-5-122b-a10b' },
      { model: 'kimi-k2-5', privacy: 'plain' }
    ) || '',
    /Cannot continue a e2ee conversation with a plain session/
  );
});

test('continueConversationError infers TEE from legacy history without privacy', () => {
  assert.match(
    continueConversationError(
      { model: 'tee-qwen3-5-122b-a10b' },
      { model: 'kimi-k2-5', privacy: 'plain' }
    ) || '',
    /Cannot continue a tee conversation with a plain session/
  );
});
