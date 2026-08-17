import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { apiRequest, chatCompletion, parseUsageHeaders, VeniceApiError } from './api.js';
import { probeTopUpRequirements, submitTopUp } from './wallet-api.js';

function withTempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'venice-x402-test-'));
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  return dir;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function runNodeModule(
  script: string,
  homeDir: string,
  extraEnv: Record<string, string> = {}
) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
  };
  delete env.VENICE_API_KEY;
  delete env.X_SIGN_IN_WITH_X;
  for (const [key, value] of Object.entries(extraEnv)) {
    env[key] = value;
  }
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env,
  });
}

test('x402-only requests send X-Sign-In-With-X and no Authorization', () => {
  const home = withTempHome();
  const apiUrl = new URL('./api.js', import.meta.url).href;
  try {
    const script = `
      import { getHeaders } from ${JSON.stringify(apiUrl)};
      const headers = getHeaders(true);
      console.log(JSON.stringify({
        x402: headers['X-Sign-In-With-X'] ?? null,
        authorization: headers.Authorization ?? null,
      }));
    `;

    const x402Result = runNodeModule(script, home, { X_SIGN_IN_WITH_X: 'wallet-token' });
    assert.equal(x402Result.status, 0, x402Result.stderr);
    assert.deepEqual(JSON.parse(x402Result.stdout), {
      x402: 'wallet-token',
      authorization: null,
    });

    const keyResult = runNodeModule(script, home, { VENICE_API_KEY: 'sk-test' });
    assert.equal(keyResult.status, 0, keyResult.stderr);
    assert.deepEqual(JSON.parse(keyResult.stdout), {
      x402: null,
      authorization: 'Bearer sk-test',
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('a formerly raw-Bearer multipart path routes through the shared auth builder', () => {
  const home = withTempHome();
  const apiUrl = new URL('./api.js', import.meta.url).href;
  const tempDir = mkdtempSync(join(tmpdir(), 'venice-x402-doc-'));
  const documentPath = join(tempDir, 'notes.txt');
  writeFileSync(documentPath, 'document body');

  try {
    const script = `
      import { parseDocument } from ${JSON.stringify(apiUrl)};
      let captured;
      globalThis.fetch = async (input, init) => {
        captured = init?.headers;
        return new Response(JSON.stringify({ text: 'parsed', tokens: 1 }), {
          headers: { 'Content-Type': 'application/json' },
        });
      };
      await parseDocument(${JSON.stringify(documentPath)});
      const headers = captured instanceof Headers
        ? Object.fromEntries(captured.entries())
        : captured;
      console.log(JSON.stringify({
        x402: headers['X-Sign-In-With-X'] ?? null,
        authorization: headers.Authorization ?? null,
      }));
    `;

    const result = runNodeModule(script, home, { X_SIGN_IN_WITH_X: 'wallet-token' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      x402: 'wallet-token',
      authorization: null,
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Retry-After parses delta-seconds, HTTP-dates, and caps outliers', () => {
  const delta = VeniceApiError.fromResponse(
    new Response('{}', { headers: { 'retry-after': '2' } }),
    '{}'
  );
  assert.equal(delta.retryAfter, 2);

  const futureDate = new Date(Date.now() + 5000).toUTCString();
  const httpDate = VeniceApiError.fromResponse(
    new Response('{}', { headers: { 'retry-after': futureDate } }),
    '{}'
  );
  assert.ok(httpDate.retryAfter !== undefined);
  assert.ok(httpDate.retryAfter! >= 4 && httpDate.retryAfter! <= 6);

  const capped = VeniceApiError.fromResponse(
    new Response('{}', { headers: { 'retry-after': '999999' } }),
    '{}'
  );
  assert.equal(capped.retryAfter, 300);

  const missing = VeniceApiError.fromResponse(new Response('{}'), '{}');
  assert.equal(missing.retryAfter, undefined);
});

test('parseUsageHeaders reads X-Balance-Remaining and X-RateLimit-*', () => {
  const headers = new Headers({
    'X-Balance-Remaining': '4.230000',
    'X-RateLimit-Limit': '100',
    'X-RateLimit-Remaining': '7',
    'X-RateLimit-Reset': '1704067260',
  });
  assert.deepEqual(parseUsageHeaders(headers), {
    balanceRemainingUsd: 4.23,
    rateLimit: { limit: 100, remaining: 7, reset: 1704067260 },
  });

  assert.deepEqual(parseUsageHeaders(new Headers()), {});
  assert.deepEqual(parseUsageHeaders(new Headers({ 'X-Balance-Remaining': 'nope' })), {});
  assert.deepEqual(parseUsageHeaders(new Headers({ 'X-RateLimit-Remaining': '0' })), {
    rateLimit: { remaining: 0 },
  });
});

test('chatCompletion surfaces X-Balance-Remaining as usageHeaders', async () => {
  const originalFetch = globalThis.fetch;
  const originalX = process.env.X_SIGN_IN_WITH_X;
  try {
    process.env.X_SIGN_IN_WITH_X = 'wallet-token';
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Balance-Remaining': '4.230000',
        },
      })) as typeof fetch;

    const result = await chatCompletion([{ role: 'user', content: 'hi' }], { showSpinner: false });
    assert.equal(result.content, 'ok');
    assert.equal(result.usageHeaders?.balanceRemainingUsd, 4.23);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv('X_SIGN_IN_WITH_X', originalX);
  }
});

test('probeTopUpRequirements treats the 402 payment requirements as data', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  try {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response(JSON.stringify({
        x402Version: 2,
        accepts: [{
          scheme: 'exact',
          network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
          amount: '5000000',
          asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          payTo: '8qUL23aSj7mDWdoLMXGHFvnVCT9wd7jXcysiekroADEL',
          maxTimeoutSeconds: 300,
        }],
      }), { status: 402, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    const requirements = await probeTopUpRequirements();
    assert.equal(requirements.x402Version, 2);
    assert.equal(requirements.accepts.length, 1);
    assert.equal(requirements.accepts[0].network, 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');
    assert.match(capturedUrl, /\/x402\/top-up$/);
    assert.equal(capturedInit?.method, 'POST');
    // security: [] — the probe must not carry an Authorization header.
    assert.equal(getHeader(capturedInit, 'Authorization'), undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('submitTopUp sends the PAYMENT-SIGNATURE header and returns the credited balance', async () => {
  const originalFetch = globalThis.fetch;
  let capturedInit: RequestInit | undefined;
  try {
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      capturedInit = init;
      return new Response(JSON.stringify({
        success: true,
        data: {
          walletAddress: '0xabc',
          amountCredited: 10,
          newBalance: 22.5,
          paymentId: 'payment_01HZY8M4W4Y6QZ8B6Q4P0V3J2K',
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    const result = await submitTopUp('eyJ4NDAyVmVyc2lvbiI6Mg');
    assert.equal(result.amountCredited, 10);
    assert.equal(result.newBalance, 22.5);
    assert.equal(result.paymentId, 'payment_01HZY8M4W4Y6QZ8B6Q4P0V3J2K');
    assert.equal(getHeader(capturedInit, 'PAYMENT-SIGNATURE'), 'eyJ4NDAyVmVyc2lvbiI6Mg');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function getHeader(init: RequestInit | undefined, name: string): string | undefined {
  const headers = init?.headers;
  if (!headers) return undefined;
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  if (Array.isArray(headers)) {
    const match = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return match?.[1];
  }
  const record = headers as Record<string, string>;
  const key = Object.keys(record).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? record[key] : undefined;
}

test('a final 429 attempt rejects without looping into retry sleep', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.VENICE_API_KEY;
  const originalX = process.env.X_SIGN_IN_WITH_X;
  const home = withTempHome();
  let requestCount = 0;

  delete process.env.VENICE_API_KEY;
  process.env.X_SIGN_IN_WITH_X = 'wallet-token';

  globalThis.fetch = (async () => {
    requestCount++;
    return new Response(JSON.stringify({ error: { message: 'too many requests' } }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'retry-after': '0' },
    });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => apiRequest<unknown>('/models', { showSpinner: false, retries: 0 }),
      (error: unknown) => {
        assert.ok(error instanceof VeniceApiError);
        assert.equal((error as VeniceApiError).statusCode, 429);
        return true;
      }
    );
    assert.equal(requestCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv('VENICE_API_KEY', originalKey);
    restoreEnv('X_SIGN_IN_WITH_X', originalX);
    rmSync(home, { recursive: true, force: true });
  }
});
