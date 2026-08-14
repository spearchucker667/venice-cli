import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  dedicatedWebSearch,
  parseDocument,
  scrapeWebPage,
} from './api.js';

test('augment API helpers send the documented requests', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;
  const tempDir = mkdtempSync(join(tmpdir(), 'venice-augment-test-'));
  const documentPath = join(tempDir, 'notes.txt');
  const requests: Array<{ url: string; init?: RequestInit; body: string }> = [];

  process.env.VENICE_API_KEY = 'test-key';
  writeFileSync(documentPath, 'private document contents');

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    let body = '';
    if (init?.body && typeof init.body === 'string') {
      body = init.body;
    } else if (init?.body) {
      const chunks: Buffer[] = [];
      for await (const chunk of init.body as unknown as AsyncIterable<Buffer>) {
        chunks.push(Buffer.from(chunk));
      }
      body = Buffer.concat(chunks).toString('utf-8');
    }

    const url = String(input);
    requests.push({ url, init, body });

    if (url.endsWith('/augment/search')) {
      return jsonResponse({
        query: 'privacy news',
        results: [{
          title: 'Result',
          url: 'https://example.com/result',
          content: 'Snippet',
          date: '2026-08-14',
        }],
      });
    }
    if (url.endsWith('/augment/scrape')) {
      return jsonResponse({
        url: 'https://example.com',
        content: '# Example',
        format: 'markdown',
      });
    }
    return jsonResponse({ text: 'private document contents', tokens: 3 });
  }) as typeof fetch;

  try {
    const search = await dedicatedWebSearch('privacy news', {
      limit: 7,
      provider: 'google',
    });
    const scrape = await scrapeWebPage('https://example.com');
    const parsed = await parseDocument(documentPath);

    assert.equal(search.results[0].title, 'Result');
    assert.equal(scrape.content, '# Example');
    assert.deepEqual(parsed, { text: 'private document contents', tokens: 3 });

    assert.deepEqual(JSON.parse(requests[0].body), {
      query: 'privacy news',
      limit: 7,
      search_provider: 'google',
    });
    assert.deepEqual(JSON.parse(requests[1].body), {
      url: 'https://example.com',
    });
    assert.match(requests[2].body, /name="response_format"\r\n\r\njson/);
    assert.match(requests[2].body, /filename="notes.txt"/);
    assert.match(requests[2].body, /private document contents/);
    assert.match(
      String((requests[2].init?.headers as Record<string, string>)['Content-Type']),
      /^multipart\/form-data; boundary=/
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.VENICE_API_KEY;
    } else {
      process.env.VENICE_API_KEY = originalApiKey;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}
