import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { webSearchTool, webScrapeTool } from './search.js';

describe('Venice search tools', () => {
  afterEach(() => {
    delete process.env.VENICE_API_KEY;
  });

  it('web_search has correct schema and risk', () => {
    assert.strictEqual(webSearchTool.name, 'web_search');
    assert.strictEqual(webSearchTool.risk, 'network');
    assert.ok(webSearchTool.inputSchema.required?.includes('query'));
  });

  it('web_scrape has correct schema and risk', () => {
    assert.strictEqual(webScrapeTool.name, 'web_scrape');
    assert.strictEqual(webScrapeTool.risk, 'network');
    assert.ok(webScrapeTool.inputSchema.required?.includes('url'));
  });

  it('a pre-aborted turn signal prevents web_search from returning results (R2-005)', async () => {
    const originalFetch = globalThis.fetch;
    process.env.VENICE_API_KEY = 'test-key';

    const controller = new AbortController();
    controller.abort();

    globalThis.fetch = (async (_input, init) => {
      if (init?.signal?.aborted) {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        throw error;
      }
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const result = await webSearchTool.execute(
        { query: 'abort me' },
        {
          workspaceRoot: '/tmp/ws',
          sessionId: 's1',
          objective: 'cancel',
          runtimeState: {} as never,
          signal: controller.signal,
        }
      );
      assert.strictEqual(result.ok, false, 'an aborted turn must not return a successful search');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
