import assert from 'node:assert/strict';
import test from 'node:test';
import { apiRequest } from './api.js';
import {
  fetchWithAuthFallback,
  validateApiKey,
  getLastRequestAuth,
  clearLastRequestAuth,
} from './transport.js';

function jsonError(status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: { message: 'boom' } }), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
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

test('auth rejection is retried once with the fallback API key', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;
  const originalFallback = process.env.VENICE_API_KEY_FALLBACK;
  process.env.VENICE_API_KEY = 'primary-key';
  process.env.VENICE_API_KEY_FALLBACK = 'fallback-key';

  const authorizations: Array<string | null> = [];
  let fetchCalls = 0;
  globalThis.fetch = (async (_input, init) => {
    fetchCalls++;
    const headers = new Headers((init?.headers ?? {}) as Record<string, string>);
    authorizations.push(headers.get('authorization'));
    return fetchCalls === 1 ? jsonError(401) : jsonOk({ ok: true });
  }) as typeof fetch;

  try {
    const result = await apiRequest<{ ok: boolean }>('/models', { method: 'GET', retries: 0 });
    assert.deepEqual(result, { ok: true });
    assert.equal(fetchCalls, 2, 'exactly one retry with the fallback credential');
    assert.equal(authorizations[0], 'Bearer primary-key');
    assert.equal(authorizations[1], 'Bearer fallback-key');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.VENICE_API_KEY;
    else process.env.VENICE_API_KEY = originalApiKey;
    if (originalFallback === undefined) delete process.env.VENICE_API_KEY_FALLBACK;
    else process.env.VENICE_API_KEY_FALLBACK = originalFallback;
  }
});

test('auth rejection falls back to the wallet token when no distinct fallback key exists', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;
  const originalFallback = process.env.VENICE_API_KEY_FALLBACK;
  const originalWallet = process.env.X_SIGN_IN_WITH_X;
  // Fallback key equals the active key, so the wallet token is the next
  // credential to try — the X-SIGN-IN-WITH_X path gets the same retry.
  process.env.VENICE_API_KEY = 'primary-key';
  process.env.VENICE_API_KEY_FALLBACK = 'primary-key';
  process.env.X_SIGN_IN_WITH_X = 'wallet-token';

  const seen: Array<{ authorization: string | null; xSignInWithX: string | null }> = [];
  let fetchCalls = 0;
  globalThis.fetch = (async (_input, init) => {
    fetchCalls++;
    const headers = new Headers((init?.headers ?? {}) as Record<string, string>);
    seen.push({
      authorization: headers.get('authorization'),
      xSignInWithX: headers.get('x-sign-in-with-x'),
    });
    return fetchCalls === 1 ? jsonError(401) : jsonOk({ ok: true });
  }) as typeof fetch;

  try {
    clearLastRequestAuth();
    const result = await apiRequest<{ ok: boolean }>('/models', { method: 'GET', retries: 0 });
    assert.deepEqual(result, { ok: true });
    assert.equal(fetchCalls, 2, 'exactly one retry with the wallet credential');
    assert.deepStrictEqual(seen, [
      { authorization: 'Bearer primary-key', xSignInWithX: null },
      { authorization: null, xSignInWithX: 'wallet-token' },
    ]);
    const auth = getLastRequestAuth();
    assert.equal(auth?.credential, 'fallback');
    assert.equal(auth?.kind, 'sign-in-with-x');
  } finally {
    globalThis.fetch = originalFetch;
    clearLastRequestAuth();
    if (originalApiKey === undefined) delete process.env.VENICE_API_KEY;
    else process.env.VENICE_API_KEY = originalApiKey;
    if (originalFallback === undefined) delete process.env.VENICE_API_KEY_FALLBACK;
    else process.env.VENICE_API_KEY_FALLBACK = originalFallback;
    if (originalWallet === undefined) delete process.env.X_SIGN_IN_WITH_X;
    else process.env.X_SIGN_IN_WITH_X = originalWallet;
  }
});

test('fetchWithAuthFallback retries with the wallet token when the key is rejected', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;
  const originalFallback = process.env.VENICE_API_KEY_FALLBACK;
  const originalWallet = process.env.X_SIGN_IN_WITH_X;
  process.env.VENICE_API_KEY = 'primary-key';
  process.env.VENICE_API_KEY_FALLBACK = 'primary-key';
  process.env.X_SIGN_IN_WITH_X = 'wallet-token';

  const seen: Array<{ authorization: string | null; xSignInWithX: string | null }> = [];
  let calls = 0;
  globalThis.fetch = (async (_input, init) => {
    calls++;
    const headers = new Headers((init?.headers ?? {}) as Record<string, string>);
    seen.push({
      authorization: headers.get('authorization'),
      xSignInWithX: headers.get('x-sign-in-with-x'),
    });
    return calls === 1 ? jsonError(401) : jsonOk({ ok: true });
  }) as typeof fetch;

  try {
    clearLastRequestAuth();
    const response = await fetchWithAuthFallback('https://api.venice.ai/api/v1/audio/speech', {
      method: 'POST',
    });
    assert.equal(response.status, 200);
    assert.equal(calls, 2);
    assert.deepStrictEqual(seen, [
      { authorization: 'Bearer primary-key', xSignInWithX: null },
      { authorization: null, xSignInWithX: 'wallet-token' },
    ]);
    const auth = getLastRequestAuth();
    assert.equal(auth?.credential, 'fallback');
    assert.equal(auth?.kind, 'sign-in-with-x');
  } finally {
    globalThis.fetch = originalFetch;
    clearLastRequestAuth();
    if (originalApiKey === undefined) delete process.env.VENICE_API_KEY;
    else process.env.VENICE_API_KEY = originalApiKey;
    if (originalFallback === undefined) delete process.env.VENICE_API_KEY_FALLBACK;
    else process.env.VENICE_API_KEY_FALLBACK = originalFallback;
    if (originalWallet === undefined) delete process.env.X_SIGN_IN_WITH_X;
    else process.env.X_SIGN_IN_WITH_X = originalWallet;
  }
});

test('validateApiKey probes the API with exactly the given key and reports rejection', async () => {
  const originalFetch = globalThis.fetch;
  let seenAuthorization: string | null = null;
  globalThis.fetch = (async (_input, init) => {
    const headers = new Headers((init?.headers ?? {}) as Record<string, string>);
    seenAuthorization = headers.get('authorization');
    return jsonError(401, {});
  }) as typeof fetch;
  try {
    const result = await validateApiKey('new-key');
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.equal(seenAuthorization, 'Bearer new-key', 'the probe must send exactly the key under test');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('validateApiKey tests wallet tokens with the X-Sign-In-With-X header', async () => {
  const originalFetch = globalThis.fetch;
  let seenHeader: string | null = null;
  globalThis.fetch = (async (_input, init) => {
    const headers = new Headers((init?.headers ?? {}) as Record<string, string>);
    seenHeader = headers.get('x-sign-in-with-x');
    return jsonOk({ canConsume: true });
  }) as typeof fetch;
  try {
    const result = await validateApiKey({ kind: 'sign-in-with-x', value: 'wallet-token' });
    assert.equal(result.ok, true);
    assert.equal(seenHeader, 'wallet-token');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('validateApiKey accepts a valid key and surfaces network failures', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => jsonOk({ canConsume: true })) as typeof fetch;
    const ok = await validateApiKey('good-key');
    assert.equal(ok.ok, true);

    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as typeof fetch;
    const failed = await validateApiKey('good-key');
    assert.equal(failed.ok, false);
    assert.match(failed.message ?? '', /network down/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('apiRequest records which credential served a successful request', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;
  const originalFallback = process.env.VENICE_API_KEY_FALLBACK;
  process.env.VENICE_API_KEY = 'primary-key';
  process.env.VENICE_API_KEY_FALLBACK = 'fallback-key';

  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls++;
    return fetchCalls === 1 ? jsonError(401) : jsonOk({ ok: true });
  }) as typeof fetch;

  try {
    clearLastRequestAuth();
    // Primary serves the request.
    globalThis.fetch = (async () => jsonOk({ ok: true })) as typeof fetch;
    await apiRequest<{ ok: boolean }>('/models', { method: 'GET', retries: 0 });
    const primaryAuth = getLastRequestAuth();
    assert.equal(primaryAuth?.credential, 'primary');
    assert.equal(primaryAuth?.kind, 'api-key');

    // Rejected primary -> fallback key serves it.
    fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls++;
      return fetchCalls === 1 ? jsonError(401) : jsonOk({ ok: true });
    }) as typeof fetch;
    await apiRequest<{ ok: boolean }>('/models', { method: 'GET', retries: 0 });
    const fallbackAuth = getLastRequestAuth();
    assert.equal(fallbackAuth?.credential, 'fallback');
    assert.equal(fallbackAuth?.kind, 'api-key');
  } finally {
    globalThis.fetch = originalFetch;
    clearLastRequestAuth();
    if (originalApiKey === undefined) delete process.env.VENICE_API_KEY;
    else process.env.VENICE_API_KEY = originalApiKey;
    if (originalFallback === undefined) delete process.env.VENICE_API_KEY_FALLBACK;
    else process.env.VENICE_API_KEY_FALLBACK = originalFallback;
  }
});

test('fetchWithAuthFallback retries direct media fetches with the fallback key', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;
  const originalFallback = process.env.VENICE_API_KEY_FALLBACK;
  process.env.VENICE_API_KEY = 'primary-key';
  process.env.VENICE_API_KEY_FALLBACK = 'fallback-key';

  const authorizations: Array<string | null> = [];
  let calls = 0;
  globalThis.fetch = (async (_input, init) => {
    calls++;
    const headers = new Headers((init?.headers ?? {}) as Record<string, string>);
    authorizations.push(headers.get('authorization'));
    return calls === 1 ? jsonError(401) : jsonOk({ ok: true });
  }) as typeof fetch;

  try {
    const response = await fetchWithAuthFallback('https://api.venice.ai/api/v1/audio/speech', {
      method: 'POST',
    });
    assert.equal(response.status, 200);
    assert.equal(calls, 2, 'exactly one retry with the fallback credential');
    assert.deepStrictEqual(authorizations, ['Bearer primary-key', 'Bearer fallback-key']);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.VENICE_API_KEY;
    else process.env.VENICE_API_KEY = originalApiKey;
    if (originalFallback === undefined) delete process.env.VENICE_API_KEY_FALLBACK;
    else process.env.VENICE_API_KEY_FALLBACK = originalFallback;
  }
});

test('auth rejection never retries when the fallback key equals the active credential', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;
  const originalFallback = process.env.VENICE_API_KEY_FALLBACK;
  // Primary and fallback are the same key, so there is nothing to fall back to.
  process.env.VENICE_API_KEY = 'fallback-key';
  process.env.VENICE_API_KEY_FALLBACK = 'fallback-key';

  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls++;
    return jsonError(401);
  }) as typeof fetch;

  try {
    await assert.rejects(
      apiRequest('/models', { method: 'GET', retries: 0 }),
      /Authentication failed/
    );
    assert.equal(fetchCalls, 1, 'an identical fallback credential must not trigger a retry');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.VENICE_API_KEY;
    else process.env.VENICE_API_KEY = originalApiKey;
    if (originalFallback === undefined) delete process.env.VENICE_API_KEY_FALLBACK;
    else process.env.VENICE_API_KEY_FALLBACK = originalFallback;
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
