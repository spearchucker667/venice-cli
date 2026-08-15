import assert from 'node:assert/strict';
import test from 'node:test';
import { executeTool } from './tools.js';

test('executeTool refuses a built-in tool outside the allowlist', async () => {
  const result = await executeTool(
    'calculator',
    { expression: '2 + 2' },
    { allowedTools: new Set(['datetime']) }
  );

  assert.equal(result, 'Tool not enabled: calculator');
});

test('executeTool runs a tool inside the allowlist', async () => {
  const result = await executeTool(
    'calculator',
    { expression: '2 + 2' },
    { allowedTools: new Set(['calculator']) }
  );

  assert.equal(result, 'Result: 4');
});
