import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { VeniceModelClient, UNKNOWN_CONTEXT_LIMIT } from './model-client.js';
import { ModelCatalog } from './model-catalog.js';
import type { Model } from '../types/index.js';

describe('VeniceModelClient', () => {
  afterEach(() => {
    delete process.env.VENICE_API_KEY;
  });

  it('exists and exposes complete and stream', () => {
    const client = new VeniceModelClient({ model: 'test-model' });
    assert.strictEqual(typeof client.complete, 'function');
    assert.strictEqual(typeof client.stream, 'function');
  });

  it('assembles streaming chunks, reasoning, and fragmented tool calls (VCL-R3-012)', async () => {
    process.env.VENICE_API_KEY = 'test-key';
    const originalFetch = globalThis.fetch;
    const frame = (payload: unknown) => `data: ${JSON.stringify(payload)}`;
    const toolCallChunk = (index: number, partial: { id?: string; name?: string; arguments?: string }) => {
      const tc: Record<string, unknown> = { index };
      if (partial.id) tc.id = partial.id;
      if (partial.name) tc.function = { name: partial.name, arguments: partial.arguments ?? '' };
      else tc.function = { arguments: partial.arguments };
      return frame({ choices: [{ delta: { tool_calls: [tc] } }] });
    };
    const sse = [
      frame({ id: 'completion-1', choices: [{ delta: { reasoning_content: 'Let me think' } }] }),
      frame({ choices: [{ delta: { content: 'Hello' } }] }),
      frame({ choices: [{ delta: { content: ' world' } }] }),
      toolCallChunk(0, { id: 'call_1', name: 'read_file', arguments: '' }),
      toolCallChunk(0, { arguments: '{"path"' }),
      toolCallChunk(0, { arguments: ':"a.txt"}' }),
      frame({ choices: [{ finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 } }),
      'data: [DONE]',
    ];
    globalThis.fetch = (async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          // Each SSE event is terminated by a blank line; the frame parser
          // dispatches on blank lines and joins multi-line `data:` fields.
          for (const line of sse) controller.enqueue(encoder.encode(line + '\n\n'));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }) as typeof fetch;

    try {
      const client = new VeniceModelClient({ model: 'test-model' });
      const chunks: string[] = [];
      const reasoning: string[] = [];
      const response = await client.complete(
        [{ role: 'user', content: 'hi' }],
        [],
        (chunk) => {
          if (chunk.content) chunks.push(chunk.content);
          if (chunk.reasoningContent) reasoning.push(chunk.reasoningContent);
        }
      );

      assert.strictEqual(response.content, 'Hello world');
      assert.strictEqual(response.reasoningContent, 'Let me think');
      assert.strictEqual(response.streamed, true);
      assert.strictEqual(response.finishReason, 'tool_calls');
      assert.deepStrictEqual(response.usage, { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 });
      assert.deepStrictEqual(response.toolCalls, [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
        },
      ]);
      // Incremental chunks surfaced to the caller.
      assert.deepStrictEqual(chunks, ['Hello', ' world']);
      assert.deepStrictEqual(reasoning, ['Let me think']);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('infers context limit from model id heuristics', async () => {
    const client = new VeniceModelClient({ model: 'deepseek-v3-32k' });
    const limit = await client.getModelContextLimit();
    assert.strictEqual(limit, 32000);
  });

  it('uses a conservative explicit limit for unknown models (VCL-R3-028)', async () => {
    const client = new VeniceModelClient({ model: 'unknown-model' });
    const limit = await client.getModelContextLimit();
    assert.strictEqual(limit, UNKNOWN_CONTEXT_LIMIT);
    assert.ok(limit < 128000, 'unknown models must not assume the optimistic 128k budget');
  });

  it('uses an injected catalog for offline model discovery (VCL-R3-027)', async () => {
    const model: Model = {
      id: 'offline-agent',
      type: 'text',
      model_spec: {
        availableContextTokens: 65536,
        capabilities: { supportsFunctionCalling: true, supportsReasoning: true },
      },
    };
    const catalog = new ModelCatalog({ fetcher: async () => [model] });
    const client = new VeniceModelClient({ model: 'offline-agent', catalog });

    // No network involved: profile and context limit come from the catalog.
    const profile = await client.getModelProfile();
    assert.strictEqual(profile?.id, 'offline-agent');
    assert.strictEqual(profile?.mode, 'agent');
    assert.strictEqual(profile?.contextLimit, 65536);
    assert.strictEqual(await client.getModelContextLimit(), 65536);
  });
});
