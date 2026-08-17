import { spawn } from 'node:child_process';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(new URL('../index.js', import.meta.url));

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(
  args: string[],
  homeDir: string,
  apiBaseUrl: string
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        APPDATA: homeDir,
        LOCALAPPDATA: homeDir,
        NODE_ENV: 'test',
        NO_COLOR: '1',
        VENICE_API_BASE_URL: apiBaseUrl,
        // SIGN-IN-WITH-X wallet auth, not a Bearer key
        X_SIGN_IN_WITH_X: 'siwx_base64_payload',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (status) => resolve({ status, stdout, stderr }));
  });
}

async function withApiServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  callback: (baseUrl: string, homeDir: string) => Promise<void>
): Promise<void> {
  const homeDir = mkdtempSync(join(tmpdir(), 'venice-wallet-test-'));
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await callback(baseUrl, homeDir);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())
    );
    rmSync(homeDir, { recursive: true, force: true });
  }
}

function sendJson(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

test('wallet balance fetches /x402/balance/{address} with wallet auth', async () => {
  let requestedPath = '';
  let authHeader = '';
  await withApiServer((request, response) => {
    requestedPath = request.url ?? '';
    authHeader = request.headers['x-sign-in-with-x'] as string ?? '';
    sendJson(response, {
      success: true,
      data: {
        walletAddress: '0xabc',
        balanceUsd: 12.5,
        canConsume: true,
        minimumTopUpUsd: 5,
        suggestedTopUpUsd: 10,
        diemBalanceUsd: 5.25,
      },
    });
  }, async (baseUrl, homeDir) => {
    const result = await runCli(
      ['wallet', 'balance', '0xabc', '--format', 'json'],
      homeDir,
      baseUrl
    );
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.balanceUsd, 12.5);
    assert.equal(parsed.canConsume, true);
  });
  assert.equal(requestedPath, '/x402/balance/0xabc');
  assert.equal(authHeader, 'siwx_base64_payload');
});

test('wallet balance renders a human-readable summary', async () => {
  await withApiServer((_request, response) => {
    sendJson(response, {
      success: true,
      data: {
        walletAddress: '0xabc',
        balanceUsd: 4.230000,
        canConsume: true,
        minimumTopUpUsd: 5,
        suggestedTopUpUsd: 10,
      },
    });
  }, async (baseUrl, homeDir) => {
    const result = await runCli(
      ['wallet', 'balance', '0xabc'],
      homeDir,
      baseUrl
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Wallet: 0xabc/);
    assert.match(result.stdout, /\$4\.230000/);
    assert.match(result.stdout, /Can consume: yes/);
  });
});

test('wallet transactions passes limit/offset and renders the table', async () => {
  let requestedPath = '';
  await withApiServer((request, response) => {
    requestedPath = request.url ?? '';
    sendJson(response, {
      success: true,
      data: {
        walletAddress: '0xabc',
        currentBalance: 12.35,
        transactions: [{
          id: 'tx-1',
          amount: -0.15,
          balanceAfter: 12.35,
          type: 'TOP_UP',
          createdAt: '2026-04-03T12:34:56.000Z',
          requestId: null,
          modelId: 'zai-org-glm-5-1',
        }],
        pagination: { limit: 50, offset: 0, hasMore: true },
      },
    });
  }, async (baseUrl, homeDir) => {
    const result = await runCli(
      ['wallet', 'transactions', '0xabc', '--limit', '50', '--offset', '0', '--format', 'json'],
      homeDir,
      baseUrl
    );
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.transactions.length, 1);
    assert.equal(parsed.transactions[0].type, 'TOP_UP');
    assert.equal(parsed.pagination.hasMore, true);
  });
  assert.equal(requestedPath, '/x402/transactions/0xabc?limit=50&offset=0');
});

test('wallet top-up probes 402 payment requirements and prints the signing guide', async () => {
  let authHeader = '';
  let requests = 0;
  await withApiServer((request, response) => {
    requests++;
    authHeader = request.headers.authorization as string ?? '';
    response.writeHead(402, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      x402Version: 2,
      accepts: [{
        scheme: 'exact',
        network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        amount: '5000000',
        asset: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        payTo: '8qUL23aSj7mDWdoLMXGHFvnVCT9wd7jXcysiekroADEL',
        maxTimeoutSeconds: 300,
      }],
    }));
  }, async (baseUrl, homeDir) => {
    const result = await runCli(['wallet', 'top-up'], homeDir, baseUrl);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /x402 top-up payment requirements/);
    assert.match(result.stdout, /solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp/);
    assert.match(result.stdout, /\$5\.00/);
    assert.match(result.stdout, /npm install x402/);
    assert.match(result.stdout, /createPaymentHeader/);
    assert.match(result.stdout, /venice wallet top-up --payment-signature/);
  });
  assert.equal(requests, 1);
  // security: [] — the probe must not send an Authorization header.
  assert.equal(authHeader, '');
});

test('wallet top-up --format json emits the raw payment requirements', async () => {
  await withApiServer((_request, response) => {
    response.writeHead(402, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      x402Version: 2,
      accepts: [{
        scheme: 'exact',
        network: 'eip155:8453',
        amount: '5000000',
        asset: '0xUSDC',
        payTo: '0xRECEIVER',
        maxTimeoutSeconds: 300,
      }],
    }));
  }, async (baseUrl, homeDir) => {
    const result = await runCli(['wallet', 'top-up', '--format', 'json'], homeDir, baseUrl);
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.x402Version, 2);
    assert.equal(parsed.accepts[0].network, 'eip155:8453');
  });
});

test('wallet top-up --payment-signature submits the signed header', async () => {
  let paymentHeader = '';
  await withApiServer((request, response) => {
    paymentHeader = request.headers['payment-signature'] as string ?? '';
    sendJson(response, {
      success: true,
      data: {
        walletAddress: '0xabc',
        amountCredited: 10,
        newBalance: 22.5,
        paymentId: 'payment_01',
      },
    });
  }, async (baseUrl, homeDir) => {
    const result = await runCli(
      ['wallet', 'top-up', '--payment-signature', 'eyJ4NDAy', '--format', 'json'],
      homeDir,
      baseUrl
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(paymentHeader, 'eyJ4NDAy');
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.amountCredited, 10);
    assert.equal(parsed.newBalance, 22.5);
    assert.equal(parsed.paymentId, 'payment_01');
  });
});

test('wallet transactions rejects invalid limit and offset', async () => {
  let requests = 0;
  await withApiServer((_request, response) => {
    requests++;
    sendJson(response, { success: true, data: {} });
  }, async (baseUrl, homeDir) => {
    const badLimit = await runCli(
      ['wallet', 'transactions', '0xabc', '--limit', '0'],
      homeDir,
      baseUrl
    );
    assert.equal(badLimit.status, 1);
    assert.match(badLimit.stderr, /limit must be a positive integer/);

    const badOffset = await runCli(
      ['wallet', 'transactions', '0xabc', '--offset', '-3'],
      homeDir,
      baseUrl
    );
    assert.equal(badOffset.status, 1);
    assert.match(badOffset.stderr, /offset must be a non-negative integer/);
  });
  assert.equal(requests, 0);
});
