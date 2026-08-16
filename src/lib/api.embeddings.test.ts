import assert from 'node:assert/strict';
import test from 'node:test';
import { generateEmbeddings } from './api.js';

test('generateEmbeddings returns float vectors by default', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.VENICE_API_KEY;

  process.env.VENICE_API_KEY = 'test-key';
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({
      data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
    }), { headers: { 'Content-Type': 'application/json' } })) as typeof fetch;

  try {
    const result = await generateEmbeddings('hello');
    assert.deepEqual(result, [
      { index: 0, encoding: 'float', embedding: [0.1, 0.2, 0.3] },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.VENICE_API_KEY;
    else process.env.VENICE_API_KEY = originalKey;
  }
});

test('generateEmbeddings returns base64 strings when requested', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.VENICE_API_KEY;
  const requests: Array<{ body: string }> = [];

  process.env.VENICE_API_KEY = 'test-key';
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requests.push({ body: String(init?.body) });
    return new Response(JSON.stringify({
      data: [{ embedding: 'AQID', index: 0 }],
    }), { headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  try {
    const result = await generateEmbeddings('hello', { encoding_format: 'base64' });
    assert.deepEqual(result, [
      { index: 0, encoding: 'base64', embedding: 'AQID' },
    ]);
    assert.ok(requests[0].body.includes('"encoding_format":"base64"'));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.VENICE_API_KEY;
    else process.env.VENICE_API_KEY = originalKey;
  }
});
