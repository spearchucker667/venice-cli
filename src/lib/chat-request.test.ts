import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChatCompletionBody } from './api.js';
import { supportsReasoningEffort, supportsResponseSchema, supportsXSearch } from '../types/index.js';
import type { Model } from '../types/index.js';

const messages = [{ role: 'user' as const, content: 'hello' }];

test('buildChatCompletionBody includes structured output, reasoning, cache, and venice parameters', () => {
  const body = buildChatCompletionBody(
    messages,
    {
      model: 'grok-4-20',
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'response',
          strict: true,
          schema: { type: 'object' },
        },
      },
      reasoning_effort: 'high',
      prompt_cache_key: 'session-123',
      prompt_cache_retention: '24h',
      venice_parameters: { enable_x_search: true },
    },
    false
  );

  assert.equal(body.model, 'grok-4-20');
  assert.equal(body.stream, false);
  assert.equal(body.reasoning_effort, 'high');
  assert.equal(body.prompt_cache_key, 'session-123');
  assert.equal(body.prompt_cache_retention, '24h');
  assert.deepEqual(body.venice_parameters, { enable_x_search: true });
  assert.deepEqual(body.response_format, {
    type: 'json_schema',
    json_schema: {
      name: 'response',
      strict: true,
      schema: { type: 'object' },
    },
  });
});

test('buildChatCompletionBody includes json_object response_format', () => {
  const body = buildChatCompletionBody(
    messages,
    {
      model: 'venice-uncensored',
      response_format: { type: 'json_object' },
    },
    false
  );

  assert.deepEqual(body.response_format, { type: 'json_object' });
});

test('capability helpers read advertised model features', () => {
  const model: Model = {
    id: 'grok-4-20',
    type: 'text',
    model_spec: {
      capabilities: {
        supportsResponseSchema: true,
        supportsReasoningEffort: true,
        supportsXSearch: true,
      },
    },
  };

  assert.equal(supportsResponseSchema(model), true);
  assert.equal(supportsReasoningEffort(model), true);
  assert.equal(supportsXSearch(model), true);
  assert.equal(supportsXSearch({ id: 'kimi-k2-5' }), false);
});
