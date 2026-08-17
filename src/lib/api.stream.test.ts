import test from 'node:test';
import assert from 'node:assert';
import { chatCompletionStream, VeniceApiError } from './api.js';

test('SSE parser: handles complete lines, optional spaces, and EOF without trailing newline', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;

  try {
    process.env.VENICE_API_KEY = 'test-key';

    // R2-010: the stream must end with a clean terminal marker (finish_reason
    // or [DONE]); the last frame intentionally has no trailing newline to
    // exercise the EOF tail flush.
    const chunks = [
      'data:{"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n', // space after data:
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}', // no trailing newline at EOF
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

    assert.equal(events.length, 4); // "Hel", "lo", finish_reason, { done: true }
    assert.equal(events[0].content, 'Hel');
    assert.equal(events[1].content, 'lo');
    assert.equal(events[2].finish_reason, 'stop');
    assert.equal(events[3].done, true);
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

test('SSE parser: EOF without a completion marker rejects with STREAM_TRUNCATED (R2-010)', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;

  try {
    process.env.VENICE_API_KEY = 'test-key';

    globalThis.fetch = (async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')
          );
          // Socket closes without [DONE] and without a finish_reason.
          controller.close();
        }
      });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }) as typeof fetch;

    const stream = chatCompletionStream([{ role: 'user', content: 'test' }]);
    const events: Array<{ content?: string; done?: boolean }> = [];
    let thrown: unknown;
    try {
      for await (const event of stream) {
        events.push(event);
      }
    } catch (err) {
      thrown = err;
    }

    assert.ok(thrown, 'truncated EOF must throw instead of reporting success');
    assert.ok(thrown instanceof VeniceApiError, `expected VeniceApiError, got ${(thrown as Error)?.constructor?.name}`);
    assert.equal((thrown as VeniceApiError).code, 'STREAM_TRUNCATED');
    assert.match((thrown as VeniceApiError).message, /truncated/);
    // Deltas emitted before the truncation are still surfaced.
    assert.equal(events.length, 1);
    assert.equal(events[0].content, 'partial');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.VENICE_API_KEY;
    } else {
      process.env.VENICE_API_KEY = originalApiKey;
    }
  }
});

test('SSE parser: assembles multi-line data: frames (R2-010)', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;

  try {
    process.env.VENICE_API_KEY = 'test-key';

    // One event whose payload is split across two `data:` lines (joined with
    // \n per the SSE spec; the split falls between JSON tokens so the joined
    // payload stays valid JSON), followed by a finish_reason frame.
    globalThis.fetch = (async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"choices":[{"delta":{"content":"Hel"}}' +
              '\ndata: ]}\n\n' +
              'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
            )
          );
          controller.close();
        }
      });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }) as typeof fetch;

    const stream = chatCompletionStream([{ role: 'user', content: 'test' }]);
    const events: Array<{ content?: string; finish_reason?: string; done?: boolean }> = [];
    for await (const event of stream) {
      events.push(event);
    }

    assert.equal(events.length, 3); // "Hel", finish_reason, { done: true }
    assert.equal(events[0].content, 'Hel');
    assert.equal(events[1].finish_reason, 'stop');
    assert.equal(events[2].done, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.VENICE_API_KEY;
    } else {
      process.env.VENICE_API_KEY = originalApiKey;
    }
  }
});

test('SSE parser: handles CRLF framing and a [DONE] marker split across chunks (R2-010)', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;

  try {
    process.env.VENICE_API_KEY = 'test-key';

    globalThis.fetch = (async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('data: {"choices":[{"delta":{"content":"A"}}]}\r\n\r\ndata: [DO')
          );
          controller.enqueue(new TextEncoder().encode('NE]\r\n\r\n'));
          controller.close();
        }
      });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }) as typeof fetch;

    const stream = chatCompletionStream([{ role: 'user', content: 'test' }]);
    const events: Array<{ content?: string; done?: boolean }> = [];
    for await (const event of stream) {
      events.push(event);
    }

    assert.equal(events.length, 2); // "A", { done: true }
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

test('SSE parser: mid-stream json.error throws VeniceApiError instead of swallowing (P0)', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;

  try {
    process.env.VENICE_API_KEY = 'test-key';

    globalThis.fetch = (async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n' +
                'data: {"error":{"message":"rate limit exceeded","code":"rate_limit_exceeded"}}\n\n'
            )
          );
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }) as typeof fetch;

    const stream = chatCompletionStream([{ role: 'user', content: 'test' }]);
    const events: Array<{ content?: string; done?: boolean }> = [];
    let thrown: unknown;
    try {
      for await (const event of stream) {
        events.push(event);
      }
    } catch (err) {
      thrown = err;
    }

    assert.ok(thrown, 'mid-stream json.error must surface as a thrown error, not silent empty output');
    assert.ok(thrown instanceof VeniceApiError, `expected VeniceApiError, got ${(thrown as Error)?.constructor?.name}`);
    assert.match((thrown as VeniceApiError).message, /rate limit exceeded/);
    assert.equal((thrown as VeniceApiError).code, 'rate_limit_exceeded');
    // Content emitted before the error is still surfaced to the caller.
    assert.equal(events.length, 1);
    assert.equal(events[0].content, 'partial');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.VENICE_API_KEY;
    } else {
      process.env.VENICE_API_KEY = originalApiKey;
    }
  }
});

test('SSE parser: non-SSE JSON error response throws VeniceApiError (P2 media fix)', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;

  try {
    process.env.VENICE_API_KEY = 'test-key';

    // A 200 with an application/json body is an error envelope, not an SSE stream.
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ error: { message: 'upstream failure', code: 'upstream' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const stream = chatCompletionStream([{ role: 'user', content: 'test' }]);
    await assert.rejects(
      async () => {
        for await (const _event of stream) {
          /* drain */
        }
      },
      (err: unknown) => err instanceof VeniceApiError && /upstream failure/.test(err.message)
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.VENICE_API_KEY;
    } else {
      process.env.VENICE_API_KEY = originalApiKey;
    }
  }
});

test('SSE parser: malformed SSE frame surfaces a bounded snippet instead of silent drop (VC-KIMI-031)', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;

  try {
    process.env.VENICE_API_KEY = 'test-key';

    globalThis.fetch = (async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {this is not valid json'));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }) as typeof fetch;

    const stream = chatCompletionStream([{ role: 'user', content: 'test' }]);
    await assert.rejects(
      async () => {
        for await (const _event of stream) {
          /* drain */
        }
      },
      /Malformed SSE frame from API/
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.VENICE_API_KEY;
    } else {
      process.env.VENICE_API_KEY = originalApiKey;
    }
  }
});

test('SSE parser: aborting the request signal cancels the reader cleanly (P1 stream cancellation)', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;

  try {
    process.env.VENICE_API_KEY = 'test-key';

    let cancelCalled = false;
    globalThis.fetch = (async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"A"}}]}\n\n'));
          // Leave the stream open so the abort/cancel path is exercised.
        },
        cancel() {
          cancelCalled = true;
        },
      });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }) as typeof fetch;

    const controller = new AbortController();
    const stream = chatCompletionStream([{ role: 'user', content: 'test' }], { abortSignal: controller.signal });
    const events: Array<{ content?: string; done?: boolean }> = [];
    for await (const event of stream) {
      events.push(event);
      if (event.content === 'A') {
        controller.abort(); // triggers reader.cancel() -> stream cancel; pending read resolves done:true
      }
    }

    assert.equal(cancelCalled, true, 'reader.cancel() must be invoked on abort');
    assert.equal(events.length, 2, "expected the chunk plus the final { done: true }");
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

test('an external abort during the header phase propagates as AbortError and is not retried (VCL-002)', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;

  try {
    process.env.VENICE_API_KEY = 'test-key';

    let requestCount = 0;
    let fetchObservedAbort = false;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      requestCount++;
      init?.signal?.addEventListener('abort', () => { fetchObservedAbort = true; });
      // Simulate a server that has not yet sent headers: block until the
      // request is aborted.
      await new Promise<void>((resolve) => {
        if (init?.signal?.aborted) return resolve();
        init?.signal?.addEventListener('abort', () => resolve(), { once: true });
      });
      throw new DOMException('The operation was aborted', 'AbortError');
    }) as typeof fetch;

    const controller = new AbortController();
    const stream = chatCompletionStream([{ role: 'user', content: 'test' }], { abortSignal: controller.signal });
    const next = stream[Symbol.asyncIterator]().next();

    // Give the fetch a moment to start, then abort the turn signal.
    await new Promise((r) => setTimeout(r, 10));
    controller.abort();

    await assert.rejects(next, (err: unknown) => err instanceof Error && err.name === 'AbortError');
    assert.strictEqual(fetchObservedAbort, true, 'the in-flight fetch must observe the abort');
    assert.strictEqual(requestCount, 1, 'an external abort must never be retried');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.VENICE_API_KEY;
    } else {
      process.env.VENICE_API_KEY = originalApiKey;
    }
  }
});
