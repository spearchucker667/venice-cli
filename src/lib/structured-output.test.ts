import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  loadResponseFormat,
  normalizeResponseFormat,
  parseStructuredContent,
  resolveResponseFormat,
  validateAgainstSchema,
} from './structured-output.js';

const mathSchema = {
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          explanation: { type: 'string' },
          output: { type: 'string' },
        },
        required: ['explanation', 'output'],
        additionalProperties: false,
      },
    },
    final_answer: { type: 'string' },
  },
  required: ['steps', 'final_answer'],
  additionalProperties: false,
};

test('normalizeResponseFormat wraps a raw JSON Schema', () => {
  const format = normalizeResponseFormat(mathSchema);

  assert.equal(format.type, 'json_schema');
  assert.equal(format.json_schema?.name, 'response');
  assert.equal(format.json_schema?.strict, true);
  assert.deepEqual(format.json_schema?.schema, mathSchema);
});

test('normalizeResponseFormat accepts a named schema wrapper', () => {
  const format = normalizeResponseFormat({
    name: 'math_response',
    strict: true,
    schema: mathSchema,
  });

  assert.equal(format.json_schema?.name, 'math_response');
  assert.deepEqual(format.json_schema?.schema, mathSchema);
});

test('normalizeResponseFormat accepts a full response_format object', () => {
  const format = normalizeResponseFormat({
    type: 'json_schema',
    json_schema: {
      name: 'math_response',
      schema: mathSchema,
    },
  });

  assert.equal(format.type, 'json_schema');
  assert.equal(format.json_schema?.strict, true);
  assert.equal(format.json_schema?.name, 'math_response');
});

test('resolveResponseFormat accepts --json and rejects combining it with --json-schema', () => {
  const format = resolveResponseFormat({ json: true });
  assert.deepEqual(format, { type: 'json_object' });
  assert.equal(resolveResponseFormat({}), undefined);
  assert.throws(
    () => resolveResponseFormat({ json: true, jsonSchema: 'schema.json' }),
    /Cannot combine --json and --json-schema/
  );
});

test('loadResponseFormat reads a schema file and rejects missing files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'venice-schema-'));

  try {
    const schemaPath = join(dir, 'schema.json');
    writeFileSync(schemaPath, JSON.stringify(mathSchema));

    const format = loadResponseFormat(schemaPath);
    assert.equal(format.type, 'json_schema');
    assert.deepEqual(format.json_schema?.schema, mathSchema);

    assert.throws(
      () => loadResponseFormat(join(dir, 'missing.json')),
      /not found/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parseStructuredContent extracts JSON from fenced responses', () => {
  const parsed = parseStructuredContent('```json\n{"final_answer":"4"}\n```');
  assert.deepEqual(parsed, { final_answer: '4' });
});

test('validateAgainstSchema reports missing and extra fields', () => {
  const valid = {
    steps: [{ explanation: 'add', output: '2+2' }],
    final_answer: '4',
  };
  assert.deepEqual(validateAgainstSchema(valid, mathSchema), []);

  const missing = { steps: [] };
  const missingErrors = validateAgainstSchema(missing, mathSchema);
  assert.ok(missingErrors.some((error) => error.includes('final_answer')));

  const extra = { ...valid, extra: true };
  const extraErrors = validateAgainstSchema(extra, mathSchema);
  assert.ok(extraErrors.some((error) => error.includes('unexpected property')));
});
