import { describe, it } from 'node:test';
import assert from 'node:assert';
import { VeniceModelClient } from './model-client.js';

describe('VeniceModelClient', () => {
  it('exists and exposes complete and stream', () => {
    const client = new VeniceModelClient({ model: 'test-model' });
    assert.strictEqual(typeof client.complete, 'function');
    assert.strictEqual(typeof client.stream, 'function');
  });

  it('infers context limit from model id heuristics', async () => {
    const client = new VeniceModelClient({ model: 'deepseek-v3-32k' });
    const limit = await client.getModelContextLimit();
    assert.strictEqual(limit, 32000);
  });

  it('defaults to 128k for unknown models', async () => {
    const client = new VeniceModelClient({ model: 'unknown-model' });
    const limit = await client.getModelContextLimit();
    assert.strictEqual(limit, 128000);
  });
});
