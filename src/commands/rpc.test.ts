import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  MAX_RPC_BATCH,
  buildJsonRpcRequest,
  jsonRpcHasError,
  parseRpcParam,
  readBatchFile,
} from './rpc.js';

test('parseRpcParam keeps hex and tags as strings and parses JSON tokens', () => {
  assert.equal(parseRpcParam('0xabc'), '0xabc');
  assert.equal(parseRpcParam('latest'), 'latest');
  assert.equal(parseRpcParam('true'), true);
  assert.equal(parseRpcParam('false'), false);
  assert.equal(parseRpcParam('null'), null);
  assert.equal(parseRpcParam('42'), 42);
  assert.equal(parseRpcParam('0'), 0);
  assert.equal(parseRpcParam('01'), '01');
  assert.equal(parseRpcParam('"quoted"'), 'quoted');
  assert.deepEqual(parseRpcParam('{"to":"0x1"}'), { to: '0x1' });
  assert.deepEqual(parseRpcParam('[1,2]'), [1, 2]);
  assert.throws(() => parseRpcParam('{not-json'), /Invalid JSON parameter/);
});

test('buildJsonRpcRequest maps CLI args into a single JSON-RPC body', () => {
  assert.deepEqual(buildJsonRpcRequest('eth_blockNumber'), {
    jsonrpc: '2.0',
    method: 'eth_blockNumber',
    params: [],
    id: 1,
  });
  assert.deepEqual(
    buildJsonRpcRequest('eth_getBalance', ['0xabc', 'latest']),
    {
      jsonrpc: '2.0',
      method: 'eth_getBalance',
      params: ['0xabc', 'latest'],
      id: 1,
    }
  );
});

test('readBatchFile validates a JSON-RPC array and enforces the 100-item cap', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'venice-rpc-batch-'));

  try {
    const batchPath = join(tempDir, 'reqs.json');
    writeFileSync(
      batchPath,
      JSON.stringify([
        { jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 },
        { jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 2 },
      ])
    );
    assert.equal(readBatchFile(batchPath).length, 2);

    const tooManyPath = join(tempDir, 'too-many.json');
    writeFileSync(
      tooManyPath,
      JSON.stringify(
        Array.from({ length: MAX_RPC_BATCH + 1 }, (_, id) => ({
          jsonrpc: '2.0',
          method: 'eth_chainId',
          params: [],
          id,
        }))
      )
    );
    assert.throws(() => readBatchFile(tooManyPath), /limited to 100/);

    const objectPath = join(tempDir, 'object.json');
    writeFileSync(objectPath, JSON.stringify({ method: 'eth_chainId' }));
    assert.throws(() => readBatchFile(objectPath), /JSON array/);

    assert.throws(() => readBatchFile(join(tempDir, 'missing.json')), /not found/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('jsonRpcHasError detects single and batch RPC errors', () => {
  assert.equal(jsonRpcHasError({ jsonrpc: '2.0', id: 1, result: '0x1' }), false);
  assert.equal(
    jsonRpcHasError({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32602, message: 'invalid params' },
    }),
    true
  );
  assert.equal(
    jsonRpcHasError([
      { jsonrpc: '2.0', id: 1, result: '0x1' },
      { jsonrpc: '2.0', id: 2, error: { code: -32602, message: 'invalid params' } },
    ]),
    true
  );
});
