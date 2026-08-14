import assert from 'node:assert/strict';
import test from 'node:test';
import { modelIdImpliesPrivateMode, resolveChatPrivacyMode } from './chat.js';
import type { Model } from '../types/index.js';

const e2eeModel: Model = {
  id: 'e2ee-qwen3-5-122b-a10b',
  type: 'text',
  model_spec: { capabilities: { supportsE2EE: true, supportsTeeAttestation: true } },
};

const plainModel: Model = {
  id: 'kimi-k2-5',
  type: 'text',
};

test('modelIdImpliesPrivateMode detects E2EE/TEE ids without a catalog', () => {
  assert.equal(modelIdImpliesPrivateMode('e2ee-qwen3-5-122b-a10b'), true);
  assert.equal(modelIdImpliesPrivateMode('tee-qwen3-5-122b-a10b'), true);
  assert.equal(modelIdImpliesPrivateMode('kimi-k2-5'), false);
});

test('catalog failure + E2EE model id fails closed', () => {
  const result = resolveChatPrivacyMode({
    modelId: 'e2ee-qwen3-5-122b-a10b',
    catalogFailed: true,
  });
  assert.equal(result.useE2EE, false);
  assert.match(result.error || '', /refusing to send this request in the clear/);
});

test('catalog failure + --e2ee fails closed', () => {
  const result = resolveChatPrivacyMode({
    modelId: 'unknown-model',
    catalogFailed: true,
    e2eeFlag: true,
  });
  assert.match(result.error || '', /refusing to send this request in the clear/);
});

test('catalog failure + plain model continues without encryption', () => {
  const result = resolveChatPrivacyMode({
    modelId: 'kimi-k2-5',
    catalogFailed: true,
  });
  assert.deepEqual(result, { useE2EE: false, useTEE: false });
});

test('known E2EE model auto-enables encryption', () => {
  const result = resolveChatPrivacyMode({
    modelId: e2eeModel.id,
    modelInfo: e2eeModel,
    catalogFailed: false,
  });
  assert.deepEqual(result, { useE2EE: true, useTEE: false });
});

test('plain model is unchanged when the catalog is available', () => {
  const result = resolveChatPrivacyMode({
    modelId: plainModel.id,
    modelInfo: plainModel,
    catalogFailed: false,
  });
  assert.deepEqual(result, { useE2EE: false, useTEE: false });
});
