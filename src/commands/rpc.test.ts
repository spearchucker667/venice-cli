import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  MAX_RPC_BATCH,
  MAX_RPC_BATCH_BYTES,
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
  assert.throws(() => parseRpcParam('9007199254740993'), /Unsafe numeric literal/);
  assert.throws(() => parseRpcParam('1e400'), /Unsafe numeric literal/);
});

test('parseRpcParam rejects unsafe numeric literals at every JSON depth', () => {
  const unsafeLiterals = [
    '9007199254740992',
    '-9007199254740992',
    '9007199254740992.0',
    '9.007199254740992e15',
    '-9.007199254740992E+15',
    '9007199254740991.1',
    '-9007199254740991.1',
    '9.0071992547409911e15',
    '-90071992547409911e-1',
    '1e400',
    '{"amount":9007199254740993}',
    '{"nested":{"amount":-9007199254740992}}',
    '[0,{"amounts":[1,9.007199254740992e15]}]',
    '{"amount":1e400}',
  ];

  for (const literal of unsafeLiterals) {
    assert.throws(
      () => parseRpcParam(literal),
      /Unsafe numeric literal.*Quote it as a string.*chain-native hex/
    );
  }
});

test('parseRpcParam preserves safe decimals and ignores numbers in JSON strings', () => {
  assert.deepEqual(
    parseRpcParam(
      '{"decimal":1.25,"exponent":1.25e3,"max":9007199254740991,' +
      '"maxDecimal":9007199254740991.0,"maxExponent":9.007199254740991e15,' +
      '"belowMax":9007199254740990.999,' +
      '"values":["9007199254740991.1","1e400","escaped: \\"-9007199254740992\\""]}'
    ),
    {
      decimal: 1.25,
      exponent: 1250,
      max: Number.MAX_SAFE_INTEGER,
      maxDecimal: Number.MAX_SAFE_INTEGER,
      maxExponent: Number.MAX_SAFE_INTEGER,
      belowMax: Number.MAX_SAFE_INTEGER,
      values: ['9007199254740991.1', '1e400', 'escaped: "-9007199254740992"'],
    }
  );
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
  assert.throws(() => buildJsonRpcRequest('../eth_blockNumber'), /Invalid JSON-RPC method/);
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

    const invalidEnvelopePath = join(tempDir, 'invalid-envelope.json');
    writeFileSync(invalidEnvelopePath, JSON.stringify([{ method: 'eth_chainId', id: 1 }]));
    assert.throws(() => readBatchFile(invalidEnvelopePath), /jsonrpc/);

    const invalidParamsPath = join(tempDir, 'invalid-params.json');
    writeFileSync(
      invalidParamsPath,
      JSON.stringify([{ jsonrpc: '2.0', method: 'eth_chainId', params: 'bad', id: 1 }])
    );
    assert.throws(() => readBatchFile(invalidParamsPath), /params must be an array or object/);

    assert.throws(() => readBatchFile(join(tempDir, 'missing.json')), /not found/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('readBatchFile validates raw numeric literals in ids and nested params', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'venice-rpc-batch-numbers-'));

  try {
    const cases = [
      ['unsafe-id.json', '[{"jsonrpc":"2.0","method":"eth_chainId","id":9007199254740993}]'],
      [
        'unsafe-param.json',
        '[{"jsonrpc":"2.0","method":"eth_call",' +
        '"params":[{"nested":[-9007199254740992]}],"id":1}]',
      ],
      [
        'unsafe-exponent.json',
        '[{"jsonrpc":"2.0","method":"eth_call",' +
        '"params":{"amount":9.007199254740992e15},"id":1}]',
      ],
      [
        'rounds-to-safe.json',
        '[{"jsonrpc":"2.0","method":"eth_call",' +
        '"params":{"amount":9007199254740991.1},"id":1}]',
      ],
      [
        'non-finite.json',
        '[{"jsonrpc":"2.0","method":"eth_call","params":[1e400],"id":1}]',
      ],
    ] as const;

    for (const [name, contents] of cases) {
      const filePath = join(tempDir, name);
      writeFileSync(filePath, contents);
      assert.throws(() => readBatchFile(filePath), /Unsafe numeric literal in JSON batch file/);
    }

    const safePath = join(tempDir, 'safe.json');
    writeFileSync(
      safePath,
      '[{"jsonrpc":"2.0","method":"eth_call",' +
      '"params":{"decimal":1.25,"values":["9007199254740993","escaped: \\"1e400\\""]},' +
      '"id":9007199254740991}]'
    );
    assert.deepEqual(readBatchFile(safePath), [{
      jsonrpc: '2.0',
      method: 'eth_call',
      params: {
        decimal: 1.25,
        values: ['9007199254740993', 'escaped: "1e400"'],
      },
      id: Number.MAX_SAFE_INTEGER,
    }]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('readBatchFile rejects files over the byte cap before parsing', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'venice-rpc-batch-size-'));

  try {
    const exactLimitPath = join(tempDir, 'exact-limit.json');
    const validBatch = '[{"jsonrpc":"2.0","method":"eth_chainId","id":1}]';
    writeFileSync(
      exactLimitPath,
      validBatch + ' '.repeat(MAX_RPC_BATCH_BYTES - Buffer.byteLength(validBatch))
    );
    assert.equal(readBatchFile(exactLimitPath).length, 1);

    const oversizedPath = join(tempDir, 'oversized.json');
    writeFileSync(oversizedPath, Buffer.alloc(MAX_RPC_BATCH_BYTES + 1, 0x20));
    assert.throws(
      () => readBatchFile(oversizedPath),
      new RegExp(`${MAX_RPC_BATCH_BYTES}-byte \\(1 MiB\\) limit.*${MAX_RPC_BATCH_BYTES + 1}`)
    );
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
