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

test('buildChatCompletionBody preserves multimodal message content', () => {
  const body = buildChatCompletionBody(
    [{
      role: 'user',
      content: [
        { type: 'text', text: 'what is in this picture?' },
        { type: 'image_url', image_url: { url: 'https://example.com/photo.jpg' } },
      ],
    }],
    { model: 'qwen3-vl-235b-a22b' },
    false
  );

  assert.deepEqual(body.messages, [{
    role: 'user',
    content: [
      { type: 'text', text: 'what is in this picture?' },
      { type: 'image_url', image_url: { url: 'https://example.com/photo.jpg' } },
    ],
  }]);
});

test('buildChatCompletionBody forwards Venice/OpenAI-compat fields (VCL-R3-018)', () => {
  const body = buildChatCompletionBody(
    messages,
    {
      model: 'zai-org-glm-5-1',
      reasoning: { effort: 'high', summary: 'concise' },
      max_temp: 1.5,
      min_temp: 0.1,
      user: 'abc-123',
      store: false,
      text: { verbosity: 'low' },
      include: ['usage'],
      metadata: { trace_id: 'trace-1' },
    },
    false
  );

  assert.deepEqual(body.reasoning, { effort: 'high', summary: 'concise' });
  assert.equal(body.max_temp, 1.5);
  assert.equal(body.min_temp, 0.1);
  assert.equal(body.user, 'abc-123');
  assert.equal(body.store, false);
  assert.deepEqual(body.text, { verbosity: 'low' });
  assert.deepEqual(body.include, ['usage']);
  assert.deepEqual(body.metadata, { trace_id: 'trace-1' });
});

test('buildChatCompletionBody omits unset compat fields', () => {
  const body = buildChatCompletionBody(messages, { model: 'm' }, false);
  for (const key of ['reasoning', 'max_temp', 'min_temp', 'user', 'store', 'text', 'include', 'metadata']) {
    assert.equal(key in body, false, `${key} must be omitted when unset`);
  }
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
