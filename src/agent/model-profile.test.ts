import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { modelCapabilitySummary, profileModel } from './model-profile.js';

describe('model profiles', () => {
  it('classifies an advertised non-tool model as chat-only', () => {
    const profile = profileModel({
      id: 'chat-model',
      type: 'text',
      model_spec: {
        availableContextTokens: 32768,
        privacy: 'private',
        capabilities: {
          supportsFunctionCalling: false,
          supportsReasoning: true,
          supportsE2EE: true,
        },
      },
    });
    assert.equal(profile.mode, 'chat-only');
    assert.equal(profile.contextLimit, 32768);
    assert.match(modelCapabilitySummary(profile), /chat only/);
    assert.match(modelCapabilitySummary(profile), /E2EE/);
  });

  it('does not invent unsupported metadata when the API omits it', () => {
    const profile = profileModel({ id: 'unknown-model', type: 'text' });
    assert.equal(profile.mode, 'agent');
    assert.equal(profile.supportsFunctionCalling, undefined);
    assert.equal(profile.contextLimit, undefined);
  });
});
