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

function runCli(args: string[], homeDir: string, apiBaseUrl: string): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: {
        ...process.env,
        HOME: homeDir,
        NODE_ENV: 'test',
        NO_COLOR: '1',
        VENICE_API_BASE_URL: apiBaseUrl,
        VENICE_API_KEY: 'test-admin-key',
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
  const homeDir = mkdtempSync(join(tmpdir(), 'venice-account-test-'));
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

test('billing usage follows opaque cursors without repeating filters', async () => {
  const queries: URLSearchParams[] = [];
  await withApiServer((request, response) => {
    assert.equal(request.headers.authorization, 'Bearer test-admin-key');
    const url = new URL(request.url ?? '/', 'http://localhost');
    queries.push(url.searchParams);
    if (url.searchParams.has('cursor')) {
      sendJson(response, {
        data: [{
          amount: -0.2,
          currency: 'USD',
          inferenceDetails: null,
          notes: 'API Inference',
          pricePerUnitUsd: 0.2,
          sku: 'image',
          timestamp: '2026-08-14T12:00:00.000Z',
          units: 1,
        }],
        nextCursor: null,
      });
    } else {
      sendJson(response, { data: [], nextCursor: 'opaque_cursor-1' });
    }
  }, async (baseUrl, homeDir) => {
    const result = await runCli(
      ['billing', 'usage', '--days', '7', '--page-size', '10', '--format', 'json'],
      homeDir,
      baseUrl
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).length, 1);
  });

  assert.equal(queries.length, 2);
  assert.ok(queries[0].has('startTimestamp'));
  assert.ok(queries[0].has('endTimestamp'));
  assert.equal(queries[0].get('pageSize'), '10');
  assert.deepEqual([...queries[1].keys()], ['cursor']);
  assert.equal(queries[1].get('cursor'), 'opaque_cursor-1');
});

test('keys create defaults to a bounded inference credential', async () => {
  let requestBody = '';
  await withApiServer((request, response) => {
    assert.equal(request.method, 'POST');
    request.setEncoding('utf8');
    request.on('data', (chunk) => { requestBody += chunk; });
    request.on('end', () => {
      sendJson(response, {
        success: true,
        data: {
          id: 'key-id',
          apiKey: 'venice-secret-once',
          apiKeyType: 'INFERENCE',
          description: 'ci',
          consumptionLimit: { usd: 5 },
          limitPeriod: 'MONTH',
          expiresAt: null,
        },
      });
    });
  }, async (baseUrl, homeDir) => {
    const result = await runCli(
      ['keys', 'create', '--name', 'ci', '--usd-limit', '5', '--limit-period', 'month', '--format', 'json'],
      homeDir,
      baseUrl
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).apiKey, 'venice-secret-once');
  });

  assert.deepEqual(JSON.parse(requestBody), {
    apiKeyType: 'INFERENCE',
    description: 'ci',
    consumptionLimit: { usd: 5 },
    limitPeriod: 'MONTH',
  });
});

test('keys delete refuses non-interactive deletion without --force', async () => {
  let requests = 0;
  await withApiServer((_request, response) => {
    requests++;
    sendJson(response, { success: true });
  }, async (baseUrl, homeDir) => {
    const result = await runCli(
      ['keys', 'delete', 'e28e82dc-9df2-4b47-b726-d0a222ef2ab5'],
      homeDir,
      baseUrl
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing to delete non-interactively without --force/);
  });
  assert.equal(requests, 0);
});

test('keys delete rejects key material before constructing a request', async () => {
  let requests = 0;
  await withApiServer((_request, response) => {
    requests++;
    sendJson(response, { success: true });
  }, async (baseUrl, homeDir) => {
    const result = await runCli(
      ['keys', 'delete', 'venice-secret-once', '--force'],
      homeDir,
      baseUrl
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Use the UUID shown by "venice keys list"/);
  });
  assert.equal(requests, 0);
});
