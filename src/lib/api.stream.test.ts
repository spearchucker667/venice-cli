import test from 'node:test';
import assert from 'node:assert';
import { chatCompletionStream } from './api.js';

test('SSE parser: handles complete lines, optional spaces, and EOF without trailing newline', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;

  try {
    process.env.VENICE_API_KEY = 'test-key';

    const chunks = [
      'data:{"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}', // Note: space after data:, no trailing newline at EOF
    ];

    let requestCount = 0;

    globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) => {
      requestCount++;
      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
          controller.close();
        }
      });

      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' }
      });
    }) as typeof fetch;

    const stream = chatCompletionStream([{ role: 'user', content: 'test' }]);
    const events = [];
    for await (const event of stream) {
      events.push(event);
    }

    assert.equal(events.length, 3); // "Hel", "lo", { done: true }
    assert.equal(events[0].content, 'Hel');
    assert.equal(events[1].content, 'lo');
    assert.equal(events[2].done, true);
    assert.equal(requestCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.VENICE_API_KEY;
    } else {
      process.env.VENICE_API_KEY = originalApiKey;
    }
  }
});

test('SSE parser: ignores comments and heartbeats', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;

  try {
    process.env.VENICE_API_KEY = 'test-key';

    const chunks = [
      ': ping\n',
      'data: {"choices":[{"delta":{"content":"A"}}]}\n\n',
      ': heartbeat\n',
      'data: [DONE]\n\n'
    ];

    globalThis.fetch = (async () => {
      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
          controller.close();
        }
      });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }) as typeof fetch;

    const stream = chatCompletionStream([{ role: 'user', content: 'test' }]);
    const events = [];
    for await (const event of stream) {
      events.push(event);
    }

    assert.equal(events.length, 2);
    assert.equal(events[0].content, 'A');
    assert.equal(events[1].done, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.VENICE_API_KEY;
    } else {
      process.env.VENICE_API_KEY = originalApiKey;
    }
  }
});
