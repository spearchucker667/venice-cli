import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { cryptoRpc, listCryptoNetworks } from './api.js';

test('listCryptoNetworks is a public GET without Authorization', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;
  const originalHome = process.env.HOME;
  const tempDir = mkdtempSync(join(tmpdir(), 'venice-rpc-networks-'));
  const requests: Array<{ url: string; init?: RequestInit }> = [];

  process.env.HOME = tempDir;
  delete process.env.VENICE_API_KEY;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return jsonResponse({
      networks: ['base-mainnet', 'ethereum-mainnet'],
    });
  }) as typeof fetch;

  try {
    const networks = await listCryptoNetworks();
    assert.deepEqual(networks, ['base-mainnet', 'ethereum-mainnet']);
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /\/crypto\/rpc\/networks$/);
    assert.equal(requests[0].init?.method ?? 'GET', 'GET');
    assert.equal(getHeader(requests[0].init, 'Authorization'), undefined);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv('VENICE_API_KEY', originalApiKey);
    restoreEnv('HOME', originalHome);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('cryptoRpc posts JSON-RPC with an API key and captures cost headers', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;
  const requests: Array<{ url: string; init?: RequestInit; body: string }> = [];

  process.env.VENICE_API_KEY = 'test-key';

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init, body: readBody(init) });
    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1' }),
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Venice-RPC-Credits': '20',
          'X-Venice-RPC-Cost-USD': '0.00001250',
        },
      }
    );
  }) as typeof fetch;

  try {
    const result = await cryptoRpc('ethereum-mainnet', {
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: 1,
    });

    assert.deepEqual(result.body, { jsonrpc: '2.0', id: 1, result: '0x1' });
    assert.equal(result.credits, '20');
    assert.equal(result.costUsd, '0.00001250');
    assert.match(requests[0].url, /\/crypto\/rpc\/ethereum-mainnet$/);
    assert.equal(requests[0].init?.method, 'POST');
    assert.equal(getHeader(requests[0].init, 'Authorization'), 'Bearer test-key');
    assert.deepEqual(JSON.parse(requests[0].body), {
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: 1,
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv('VENICE_API_KEY', originalApiKey);
  }
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function readBody(init?: RequestInit): string {
  if (!init?.body) return '';
  if (typeof init.body === 'string') return init.body;
  return String(init.body);
}

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

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
