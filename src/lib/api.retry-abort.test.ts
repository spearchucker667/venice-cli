import assert from 'node:assert/strict';
import test from 'node:test';
import { apiRequest } from './api.js';

function jsonError(status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: { message: 'boom' } }), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

test('R2-004: cancellation during Retry-After backoff unwinds promptly without retrying', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;
  process.env.VENICE_API_KEY = 'test-key';

  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls++;
    return jsonError(429, { 'Retry-After': '30' });
  }) as typeof fetch;

  const controller = new AbortController();
  try {
    const started = Date.now();
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(
      apiRequest('/chat/completions', { method: 'POST', body: {}, retries: 3, signal: controller.signal }),
      (error: unknown) => (error as Error).name === 'AbortError'
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 5000, `abort must interrupt backoff promptly (took ${elapsed}ms)`);
    assert.equal(fetchCalls, 1, 'no retry may fire against an aborted signal');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.VENICE_API_KEY;
    else process.env.VENICE_API_KEY = originalApiKey;
  }
});

test('R2-004: a pre-aborted signal never starts a live retry attempt', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;
  process.env.VENICE_API_KEY = 'test-key';

  const controller = new AbortController();
  controller.abort();
  let fetchCalls = 0;
  let sawAbortedSignal = false;
  globalThis.fetch = (async (_input, init) => {
    fetchCalls++;
    sawAbortedSignal = init?.signal?.aborted === true;
    return jsonError(500);
  }) as typeof fetch;

  try {
    await assert.rejects(
      apiRequest('/chat/completions', { method: 'POST', body: {}, retries: 3, signal: controller.signal }),
      (error: unknown) => (error as Error).name === 'AbortError'
    );
    assert.ok(sawAbortedSignal, 'the request must observe the already-aborted signal');
    assert.equal(fetchCalls, 1, 'a retry attempt must not start against an aborted parent signal');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.VENICE_API_KEY;
    else process.env.VENICE_API_KEY = originalApiKey;
  }
});
