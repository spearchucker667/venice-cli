import { spawn } from 'node:child_process';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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
  apiBaseUrl: string,
  extraEnv: NodeJS.ProcessEnv = {}
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
        VENICE_API_KEY: 'test-admin-key',
        ...extraEnv,
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

function secretFileFailureEnv(
  homeDir: string,
  failure: 'remove' | 'cleanup'
): NodeJS.ProcessEnv {
  const preloadPath = join(homeDir, 'secret-file-failure.cjs');
  writeFileSync(preloadPath, `
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const failure = process.env.VENICE_TEST_SECRET_FILE_FAILURE;
const temporaryDescriptors = new Set();
const isTemporary = (path) => String(path).endsWith('.tmp');
const injectedError = (code) => {
  const error = new Error('injected venice-secret-once');
  error.code = code;
  return error;
};
const originalOpenSync = fs.openSync;
const originalCloseSync = fs.closeSync;
const originalUnlinkSync = fs.unlinkSync;
const originalRmSync = fs.rmSync;
fs.openSync = function (path, ...args) {
  const descriptor = originalOpenSync.call(this, path, ...args);
  if (isTemporary(path)) temporaryDescriptors.add(descriptor);
  return descriptor;
};
fs.closeSync = function (descriptor, ...args) {
  if (failure === 'cleanup' && temporaryDescriptors.has(descriptor)) {
    throw injectedError('EIO');
  }
  return originalCloseSync.call(this, descriptor, ...args);
};
fs.unlinkSync = function (path, ...args) {
  if (failure === 'remove' && isTemporary(path)) {
    throw injectedError('EACCES');
  }
  return originalUnlinkSync.call(this, path, ...args);
};
fs.rmSync = function (path, ...args) {
  if ((failure === 'remove' || failure === 'cleanup') && isTemporary(path)) {
    throw injectedError('EACCES');
  }
  return originalRmSync.call(this, path, ...args);
};
syncBuiltinESMExports();
`);
  const requireOption = `--require=${preloadPath}`;
  return {
    NODE_OPTIONS: process.env.NODE_OPTIONS
      ? `${process.env.NODE_OPTIONS} ${requireOption}`
      : requireOption,
    VENICE_TEST_SECRET_FILE_FAILURE: failure,
  };
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

function sendError(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ error: { message } }));
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
    const secretFile = join(homeDir, 'ci.key');
    const result = await runCli(
      [
        'keys', 'create',
        '--name', 'ci',
        '--usd-limit', '5',
        '--limit-period', 'month',
        '--output', secretFile,
        '--format', 'json',
      ],
      homeDir,
      baseUrl
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).apiKey, undefined);
    assert.equal(JSON.parse(result.stdout).secretFile, realpathSync(secretFile));
    assert.doesNotMatch(result.stdout, /venice-secret-once/);
    assert.doesNotMatch(result.stderr, /venice-secret-once/);
    assert.equal(readFileSync(secretFile, 'utf8'), 'venice-secret-once\n');
    if (process.platform !== 'win32') assert.equal(statSync(secretFile).mode & 0o777, 0o600);
  });

  assert.deepEqual(JSON.parse(requestBody), {
    apiKeyType: 'INFERENCE',
    description: 'ci',
    consumptionLimit: { usd: 5 },
    limitPeriod: 'MONTH',
  });
});

test('keys create succeeds and warns when its published temporary duplicate remains', async () => {
  const methods: string[] = [];
  await withApiServer((request, response) => {
    methods.push(request.method ?? '');
    request.resume();
    request.on('end', () => {
      sendJson(response, {
        data: {
          id: 'e28e82dc-9df2-4b47-b726-d0a222ef2ab5',
          apiKey: 'venice-secret-once',
          apiKeyType: 'INFERENCE',
          description: 'ci',
        },
      });
    });
  }, async (baseUrl, homeDir) => {
    for (const format of ['json', 'pretty']) {
      const secretFile = join(homeDir, `${format}.key`);
      const result = await runCli(
        ['keys', 'create', '--name', 'ci', '--output', secretFile, '--format', format],
        homeDir,
        baseUrl,
        secretFileFailureEnv(homeDir, 'remove')
      );

      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(secretFile, 'utf8'), 'venice-secret-once\n');
      if (process.platform !== 'win32') assert.equal(statSync(secretFile).mode & 0o777, 0o600);
      assert.doesNotMatch(result.stdout, /venice-secret-once/);
      assert.doesNotMatch(result.stderr, /venice-secret-once/);

      const temporary = readdirSync(homeDir)
        .find((name) => name.startsWith(`.${format}.key-`) && name.endsWith('.tmp'));
      assert.ok(temporary);
      const temporaryPath = join(homeDir, temporary);
      assert.equal(readFileSync(temporaryPath, 'utf8'), 'venice-secret-once\n');
      if (process.platform !== 'win32') assert.equal(statSync(temporaryPath).mode & 0o777, 0o600);
      assert.ok(result.stderr.includes(realpathSync(temporaryPath)));
      assert.match(result.stderr, /0600 temporary duplicate remains/);
      assert.match(result.stderr, /Remove this temporary file/);

      if (format === 'json') {
        assert.equal(JSON.parse(result.stdout).secretFile, realpathSync(secretFile));
      } else {
        assert.match(result.stdout, /Created INFERENCE API key/);
        assert.match(result.stdout, /Secret saved to:/);
      }
    }
  });
  assert.deepEqual(methods, ['POST', 'POST']);
});

test('keys create cleanup reports close and removal failures and rolls back', async () => {
  const keyId = 'e28e82dc-9df2-4b47-b726-d0a222ef2ab5';
  const methods: string[] = [];
  await withApiServer((request, response) => {
    methods.push(request.method ?? '');
    if (request.method === 'POST') {
      request.resume();
      request.on('end', () => {
        sendJson(response, {
          data: {
            id: keyId,
            apiKey: 'venice-secret-once',
            apiKeyType: 'INFERENCE',
            description: 'ci',
          },
        });
      });
      return;
    }
    sendJson(response, { success: true });
  }, async (baseUrl, homeDir) => {
    const secretFile = join(homeDir, 'ci.key');
    const result = await runCli(
      ['keys', 'create', '--name', 'ci', '--output', secretFile],
      homeDir,
      baseUrl,
      secretFileFailureEnv(homeDir, 'cleanup')
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /close failed \(EIO\); remove failed \(EACCES\)/);
    assert.match(result.stderr, new RegExp(`New API key ${keyId} was deleted`));
    assert.doesNotMatch(result.stdout, /venice-secret-once/);
    assert.doesNotMatch(result.stderr, /venice-secret-once/);
    assert.equal(existsSync(secretFile), false);
    assert.equal(readdirSync(homeDir).some((name) => name.endsWith('.tmp')), true);
  });
  assert.deepEqual(methods, ['POST', 'DELETE']);
});

test('keys create deletes the remote key when committing the secret fails', async () => {
  const keyId = 'e28e82dc-9df2-4b47-b726-d0a222ef2ab5';
  const methods: string[] = [];
  let destinationPath = '';
  await withApiServer((request, response) => {
    methods.push(request.method ?? '');
    if (request.method === 'POST') {
      request.resume();
      request.on('end', () => {
        writeFileSync(destinationPath, 'won-the-race');
        sendJson(response, {
          data: {
            id: keyId,
            apiKey: 'venice-secret-once',
            apiKeyType: 'INFERENCE',
            description: 'ci',
          },
        });
      });
      return;
    }

    assert.equal(new URL(request.url ?? '/', 'http://localhost').searchParams.get('id'), keyId);
    sendJson(response, { success: true });
  }, async (baseUrl, homeDir) => {
    const secretFile = join(homeDir, 'ci.key');
    destinationPath = secretFile;
    const result = await runCli(
      ['keys', 'create', '--name', 'ci', '--output', secretFile],
      homeDir,
      baseUrl
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`New API key ${keyId} was deleted`));
    assert.match(result.stderr, /the secret was not saved/);
    assert.doesNotMatch(result.stderr, /venice-secret-once/);
    assert.equal(readFileSync(secretFile, 'utf8'), 'won-the-race');
    assert.equal(readdirSync(homeDir).some((name) => name.endsWith('.tmp')), false);
  });
  assert.deepEqual(methods, ['POST', 'DELETE']);
});

test('keys create gives a secret-free recovery command when rollback fails', async () => {
  const keyId = 'e28e82dc-9df2-4b47-b726-d0a222ef2ab5';
  const secret = 'venice-secret-once';
  const methods: string[] = [];
  let destinationPath = '';
  await withApiServer((request, response) => {
    methods.push(request.method ?? '');
    if (request.method === 'POST') {
      request.resume();
      request.on('end', () => {
        writeFileSync(destinationPath, 'existing');
        sendJson(response, {
          data: {
            id: keyId,
            apiKey: secret,
            apiKeyType: 'INFERENCE',
            description: 'ci',
          },
        });
      });
      return;
    }
    sendError(response, 500, `rollback rejected ${secret}`);
  }, async (baseUrl, homeDir) => {
    const secretFile = join(homeDir, 'ci.key');
    destinationPath = secretFile;
    const result = await runCli(
      ['keys', 'create', '--name', 'ci', '--output', secretFile],
      homeDir,
      baseUrl
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Failed to save the API key secret/);
    assert.match(result.stderr, /Automatic deletion also failed/);
    assert.match(result.stderr, new RegExp(`venice keys delete ${keyId} --force`));
    assert.doesNotMatch(result.stderr, new RegExp(secret));
    assert.equal(readFileSync(secretFile, 'utf8'), 'existing');
    assert.equal(readdirSync(homeDir).some((name) => name.endsWith('.tmp')), false);
  });
  assert.deepEqual(methods, ['POST', 'DELETE']);
});

test('keys create does not attempt deletion when creation fails', async () => {
  const methods: string[] = [];
  await withApiServer((request, response) => {
    methods.push(request.method ?? '');
    sendError(response, 500, 'creation failed');
  }, async (baseUrl, homeDir) => {
    const secretFile = join(homeDir, 'ci.key');
    const result = await runCli(
      ['keys', 'create', '--name', 'ci', '--output', secretFile],
      homeDir,
      baseUrl
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /creation failed/);
    assert.equal(existsSync(secretFile), false);
  });
  assert.deepEqual(methods, ['POST']);
});

test('keys create canonicalizes a symlinked output directory', async () => {
  await withApiServer((request, response) => {
    assert.equal(request.method, 'POST');
    request.resume();
    request.on('end', () => {
      sendJson(response, {
        data: {
          id: 'e28e82dc-9df2-4b47-b726-d0a222ef2ab5',
          apiKey: 'venice-secret-once',
          apiKeyType: 'INFERENCE',
          description: 'ci',
        },
      });
    });
  }, async (baseUrl, homeDir) => {
    const canonicalDirectory = join(homeDir, 'private-tmp');
    const aliasDirectory = join(homeDir, 'tmp');
    mkdirSync(canonicalDirectory);
    symlinkSync(canonicalDirectory, aliasDirectory);
    const requestedFile = join(aliasDirectory, 'ci.key');
    const canonicalFile = join(canonicalDirectory, 'ci.key');
    const result = await runCli(
      ['keys', 'create', '--name', 'ci', '--output', requestedFile, '--format', 'json'],
      homeDir,
      baseUrl
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).secretFile, realpathSync(canonicalFile));
    assert.equal(readFileSync(canonicalFile, 'utf8'), 'venice-secret-once\n');
    if (process.platform !== 'win32') assert.equal(statSync(canonicalFile).mode & 0o777, 0o600);
  });
});

test('keys create rejects a destination symlink without making a request', async () => {
  let requests = 0;
  await withApiServer((_request, response) => {
    requests++;
    sendJson(response, {});
  }, async (baseUrl, homeDir) => {
    const target = join(homeDir, 'target');
    const destination = join(homeDir, 'ci.key');
    writeFileSync(target, 'do-not-overwrite');
    symlinkSync(target, destination);
    const result = await runCli(
      ['keys', 'create', '--name', 'ci', '--output', destination],
      homeDir,
      baseUrl
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing to overwrite API key output/);
    assert.equal(readFileSync(target, 'utf8'), 'do-not-overwrite');
  });
  assert.equal(requests, 0);
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

test('keys show fetches one key by id and prints its details', async () => {
  let requestedPath = '';
  await withApiServer((request, response) => {
    assert.equal(request.method, 'GET');
    requestedPath = request.url ?? '';
    sendJson(response, {
      data: {
        id: 'e28e82dc-9df2-4b47-b726-d0a222ef2ab5',
        apiKeyType: 'INFERENCE',
        description: 'backend prod',
        consumptionLimits: { usd: 50, diem: 10 },
        limitPeriod: 'EPOCH',
        createdAt: '2025-10-01T12:00:00Z',
        expiresAt: null,
        lastUsedAt: '2026-04-20T10:05:00Z',
        last6Chars: '2V2jNW',
        usage: { trailingSevenDays: { usd: '4.20', diem: '0.00' } },
        currentPeriodUsage: { usd: '1.00', diem: '0.50' },
      },
    });
  }, async (baseUrl, homeDir) => {
    const result = await runCli(
      ['keys', 'show', 'e28e82dc-9df2-4b47-b726-d0a222ef2ab5', '--format', 'json'],
      homeDir,
      baseUrl
    );
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.id, 'e28e82dc-9df2-4b47-b726-d0a222ef2ab5');
    assert.equal(parsed.usage.trailingSevenDays.usd, '4.20');
  });
  assert.equal(requestedPath, '/api_keys/e28e82dc-9df2-4b47-b726-d0a222ef2ab5');
});

test('keys show rejects key material before constructing a request', async () => {
  let requests = 0;
  await withApiServer((_request, response) => {
    requests++;
    sendJson(response, { data: {} });
  }, async (baseUrl, homeDir) => {
    const result = await runCli(
      ['keys', 'show', 'venice-secret-once'],
      homeDir,
      baseUrl
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Use the UUID shown by "venice keys list"/);
  });
  assert.equal(requests, 0);
});

test('keys update sends a PATCH with only the provided fields', async () => {
  let requestBody = '';
  let requestMethod = '';
  await withApiServer((request, response) => {
    requestMethod = request.method ?? '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { requestBody += chunk; });
    request.on('end', () => {
      sendJson(response, {
        data: {
          id: 'e28e82dc-9df2-4b47-b726-d0a222ef2ab5',
          apiKeyType: 'INFERENCE',
          description: 'renamed',
          consumptionLimits: { usd: 100, diem: null },
          limitPeriod: 'MONTH',
          createdAt: '2025-10-01T12:00:00Z',
          expiresAt: '2026-12-31T23:59:59Z',
          lastUsedAt: null,
          last6Chars: '2V2jNW',
        },
      });
    });
  }, async (baseUrl, homeDir) => {
    const result = await runCli(
      [
        'keys', 'update', 'e28e82dc-9df2-4b47-b726-d0a222ef2ab5',
        '--name', 'renamed',
        '--expires', '2026-12-31T23:59:59Z',
        '--usd-limit', '100',
        '--limit-period', 'month',
        '--format', 'json',
      ],
      homeDir,
      baseUrl
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).description, 'renamed');
  });

  assert.equal(requestMethod, 'PATCH');
  assert.deepEqual(JSON.parse(requestBody), {
    id: 'e28e82dc-9df2-4b47-b726-d0a222ef2ab5',
    description: 'renamed',
    expiresAt: '2026-12-31T23:59:59Z',
    consumptionLimit: { usd: 100 },
    limitPeriod: 'MONTH',
  });
});

test('keys update --no-expires removes the expiration date', async () => {
  let requestBody = '';
  await withApiServer((request, response) => {
    request.setEncoding('utf8');
    request.on('data', (chunk) => { requestBody += chunk; });
    request.on('end', () => {
      sendJson(response, {
        data: {
          id: 'e28e82dc-9df2-4b47-b726-d0a222ef2ab5',
          apiKeyType: 'INFERENCE',
          description: 'ci',
          consumptionLimits: {},
          limitPeriod: 'EPOCH',
          createdAt: '2025-10-01T12:00:00Z',
          expiresAt: null,
          lastUsedAt: null,
          last6Chars: '2V2jNW',
        },
      });
    });
  }, async (baseUrl, homeDir) => {
    const result = await runCli(
      ['keys', 'update', 'e28e82dc-9df2-4b47-b726-d0a222ef2ab5', '--no-expires'],
      homeDir,
      baseUrl
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Expires: never/);
  });
  assert.equal(JSON.parse(requestBody).expiresAt, null);
});

test('keys rate-limits-log lists the last breaches', async () => {
  await withApiServer((request, response) => {
    assert.equal(request.url, '/api_keys/rate_limits/log');
    sendJson(response, {
      object: 'list',
      data: [
        {
          apiKeyId: 'e28e82dc-9df2-4b47-b726-d0a222ef2ab5',
          modelId: 'zai-org-glm-5-1',
          rateLimitTier: 'paid',
          rateLimitType: 'RPM',
          timestamp: '2026-04-20T12:34:56Z',
        },
      ],
    });
  }, async (baseUrl, homeDir) => {
    const result = await runCli(
      ['keys', 'rate-limits-log', '--format', 'json'],
      homeDir,
      baseUrl
    );
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].rateLimitType, 'RPM');
  });
});

test('keys web3 mints a key with an EIP-191 signed wallet token', async () => {
  const methodAndPaths: string[] = [];
  const bodies: string[] = [];
  const authHeaders: (string | undefined)[] = [];
  await withApiServer((request, response) => {
    authHeaders.push(request.headers.authorization as string | undefined);
    request.setEncoding('utf8');
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      methodAndPaths.push(`${request.method} ${request.url}`);
      bodies.push(body);
      if (request.url?.includes('generate_web3_key') && request.method === 'GET') {
        sendJson(response, { success: true, data: { token: 'jwt-ish-token' } });
        return;
      }
      sendJson(response, {
        success: true,
        data: {
          id: 'web3-key-id',
          apiKey: 'venice-web3-secret-once',
          apiKeyType: 'INFERENCE',
          description: 'Web3 API Key',
          consumptionLimit: { usd: 50 },
          limitPeriod: 'EPOCH',
          expiresAt: null,
        },
      });
    });
  }, async (baseUrl, homeDir) => {
    const secretFile = join(homeDir, 'web3.key');
    const result = await runCli(
      [
        'keys', 'web3',
        '--private-key', '0000000000000000000000000000000000000000000000000000000000000001',
        '--usd-limit', '50',
        '--output', secretFile,
        '--format', 'json',
      ],
      homeDir,
      baseUrl
    );
    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.id, 'web3-key-id');
    assert.equal(parsed.secretFile, realpathSync(secretFile));
    assert.doesNotMatch(result.stdout, /venice-web3-secret-once/);
    assert.doesNotMatch(result.stderr, /venice-web3-secret-once/);
    assert.equal(readFileSync(secretFile, 'utf8'), 'venice-web3-secret-once\n');
    if (process.platform !== 'win32') assert.equal(statSync(secretFile).mode & 0o777, 0o600);
  });

  assert.deepEqual(methodAndPaths, [
    'GET /api_keys/generate_web3_key',
    'POST /api_keys/generate_web3_key',
  ]);
  // The web3 flow is unauthenticated: no Authorization header on either call.
  assert.deepEqual(authHeaders, [undefined, undefined]);

  const mintBody = JSON.parse(bodies[1]);
  assert.equal(mintBody.token, 'jwt-ish-token');
  assert.equal(mintBody.address, '0x7e5f4552091a69125d5dfcb7b8c2659029395bdf');
  assert.match(mintBody.signature, /^0x[0-9a-f]{130}$/);
  assert.equal(mintBody.apiKeyType, 'INFERENCE');
  assert.equal(mintBody.description, 'Web3 API Key');
  assert.deepEqual(mintBody.consumptionLimit, { usd: 50 });
});
