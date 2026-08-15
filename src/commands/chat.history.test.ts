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

test('continueConversationError treats current plain privacy as authoritative', () => {
  assert.equal(
    continueConversationError(
      { model: 'kimi-k2-5', privacy: 'plain' },
      { model: 'e2ee-qwen3-5-122b-a10b', privacy: 'plain' }
    ),
    undefined
  );
  assert.equal(
    continueConversationError(
      { model: 'qwen3-5-122b-a10b', privacy: 'plain' },
      {
        model: 'qwen3-5-122b-a10b',
        privacy: 'plain',
        lastModel: {
          id: 'qwen3-5-122b-a10b',
          type: 'text',
          model_spec: { capabilities: { supportsTeeAttestation: true } },
        },
      }
    ),
    undefined
  );
});

test('continueConversationError rejects untagged private-model history into plaintext', () => {
  assert.match(
    continueConversationError(
      { model: 'e2ee-qwen3-5-122b-a10b' },
      { model: 'kimi-k2-5', privacy: 'plain', catalogAvailable: true, lastModel: { id: 'e2ee-qwen3-5-122b-a10b', type: 'text' } }
    ) || '',
    mixError
  );
  assert.match(
    continueConversationError(
      { model: 'tee-qwen3-5-122b-a10b' },
      { model: 'kimi-k2-5', privacy: 'plain', catalogAvailable: true, lastModel: { id: 'tee-qwen3-5-122b-a10b', type: 'text' } }
    ) || '',
    mixError
  );
});

test('continueConversationError rejects untagged plaintext history into E2EE/TEE', () => {
  assert.match(
    continueConversationError(
      { model: 'kimi-k2-5' },
      {
        model: 'e2ee-qwen3-5-122b-a10b',
        privacy: 'e2ee',
        catalogAvailable: true,
        lastModel: { id: 'kimi-k2-5', type: 'text' },
      }
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

test('continueConversationError refuses untagged model switches when the catalog is unavailable', () => {
  assert.match(
    continueConversationError(
      { model: 'qwen3-5-122b-a10b' },
      { model: 'kimi-k2-5', privacy: 'plain', catalogAvailable: false }
    ) || '',
    /model capabilities could not be confirmed/
  );
});

test('continueConversationError refuses same-model untagged history when the catalog is unavailable', () => {
  assert.match(
    continueConversationError(
      { model: 'qwen3-5-122b-a10b' },
      { model: 'qwen3-5-122b-a10b', privacy: 'plain', catalogAvailable: false }
    ) || '',
    /model capabilities could not be confirmed/
  );
});

test('continueConversationError refuses same-model untagged history when the prior model is absent', () => {
  assert.match(
    continueConversationError(
      { model: 'qwen3-5-122b-a10b' },
      { model: 'qwen3-5-122b-a10b', privacy: 'plain', catalogAvailable: true }
    ) || '',
    /model capabilities could not be confirmed/
  );
});

test('continueConversationError allows same-model untagged history confirmed plain by the catalog', () => {
  assert.equal(
    continueConversationError(
      { model: 'qwen3-5-122b-a10b' },
      {
        model: 'qwen3-5-122b-a10b',
        privacy: 'plain',
        catalogAvailable: true,
        lastModel: { id: 'qwen3-5-122b-a10b', type: 'text' },
      }
    ),
    undefined
  );
});

test('continueConversationError uses catalog capabilities when the model id is not obviously private', () => {
  assert.match(
    continueConversationError(
      { model: 'qwen3-5-122b-a10b' },
      {
        model: 'kimi-k2-5',
        privacy: 'plain',
        lastModel: {
          id: 'qwen3-5-122b-a10b',
          type: 'text',
          model_spec: { capabilities: { supportsTeeAttestation: true } },
        },
      }
    ) || '',
    mixError
  );
});

test('continueConversationError treats explicit plain privacy as authoritative for private model ids', () => {
  assert.equal(
    continueConversationError(
      { model: 'e2ee-qwen3-5-122b-a10b', privacy: 'plain' },
      { model: 'kimi-k2-5', privacy: 'plain' }
    ),
    undefined
  );
  assert.equal(
    continueConversationError(
      { model: 'qwen3-5-122b-a10b', privacy: 'plain' },
      {
        model: 'kimi-k2-5',
        privacy: 'plain',
        lastModel: {
          id: 'qwen3-5-122b-a10b',
          type: 'text',
          model_spec: { capabilities: { supportsTeeAttestation: true } },
        },
      }
    ),
    undefined
  );
});

test('continueConversationError rejects explicit plain private-model history into E2EE/TEE', () => {
  assert.match(
    continueConversationError(
      { model: 'e2ee-qwen3-5-122b-a10b', privacy: 'plain' },
      { model: 'e2ee-qwen3-5-122b-a10b', privacy: 'e2ee' }
    ) || '',
    mixError
  );
  assert.match(
    continueConversationError(
      { model: 'tee-qwen3-5-122b-a10b', privacy: 'plain' },
      { model: 'tee-qwen3-5-122b-a10b', privacy: 'tee' }
    ) || '',
    mixError
  );
});
