import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ModelCatalog } from './model-catalog.js';
import type { Model } from '../types/index.js';

const agentModel: Model = {
  id: 'kimi-k2',
  type: 'text',
  model_spec: {
    availableContextTokens: 131072,
    capabilities: { supportsFunctionCalling: true, supportsReasoning: true },
  },
};

describe('ModelCatalog (VCL-R3-027)', () => {
  it('uses the injected fetcher and caches within TTL', async () => {
    let fetches = 0;
    const catalog = new ModelCatalog({
      fetcher: async () => {
        fetches++;
        return [agentModel];
      },
      ttlMs: 60_000,
    });

    const first = await catalog.listModels();
    assert.strictEqual(fetches, 1);
    assert.strictEqual(first.length, 1);

    // A second lookup within the TTL hits the cache.
    const second = await catalog.listModels();
    assert.strictEqual(fetches, 1);
    assert.deepStrictEqual(second, first);

    // find() also uses the cache.
    const found = await catalog.find('kimi-k2');
    assert.strictEqual(found?.id, 'kimi-k2');
    assert.strictEqual(fetches, 1);
  });

  it('concurrent callers share a single in-flight fetch', async () => {
    let fetches = 0;
    const catalog = new ModelCatalog({
      fetcher: async () => {
        fetches++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return [agentModel];
      },
    });
    const [a, b] = await Promise.all([catalog.listModels(), catalog.listModels()]);
    assert.strictEqual(fetches, 1);
    assert.strictEqual(a.length, 1);
    assert.strictEqual(b.length, 1);
  });

  it('refetches after TTL expiry and on clear()', async () => {
    let fetches = 0;
    const catalog = new ModelCatalog({
      fetcher: async () => {
        fetches++;
        return [agentModel];
      },
      ttlMs: 5,
    });
    await catalog.listModels();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await catalog.listModels();
    assert.strictEqual(fetches, 2);

    catalog.clear();
    await catalog.listModels();
    assert.strictEqual(fetches, 3);
  });

  it('find() returns undefined for unknown ids', async () => {
    const catalog = new ModelCatalog({ fetcher: async () => [agentModel] });
    assert.strictEqual(await catalog.find('nope'), undefined);
  });
});
