import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyVideoRetrieveContentType,
  completeVideo,
  listModels,
  queueVideoGeneration,
  queueVideoUpscale,
  quoteVideoGeneration,
  retrieveVideo,
  transcribeVideo,
  videoUrlFromStatus,
} from './api.js';

test('classifyVideoRetrieveContentType branches json vs video', () => {
  assert.equal(classifyVideoRetrieveContentType('application/json'), 'json');
  assert.equal(classifyVideoRetrieveContentType('application/json; charset=utf-8'), 'json');
  assert.equal(classifyVideoRetrieveContentType('video/mp4'), 'video');
  assert.equal(classifyVideoRetrieveContentType('application/octet-stream'), 'video');
  assert.equal(classifyVideoRetrieveContentType('text/plain'), 'unknown');
});

test('videoUrlFromStatus prefers documented URL fields', () => {
  assert.equal(videoUrlFromStatus({ status: 'completed', video_url: 'https://a' }), 'https://a');
  assert.equal(videoUrlFromStatus({ status: 'completed', url: 'https://b' }), 'https://b');
  assert.equal(videoUrlFromStatus({ status: 'completed', download_url: 'https://c' }), 'https://c');
});

test('video API helpers send documented requests', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];

  process.env.VENICE_API_KEY = 'test-key';

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body && typeof init.body === 'string'
      ? JSON.parse(init.body) as Record<string, unknown>
      : {};
    requests.push({ url, body });

    if (url.includes('/video/quote')) {
      return jsonResponse({ quote: 0.12 });
    }
    if (url.includes('/video/complete')) {
      return jsonResponse({ success: true });
    }
    if (url.includes('/video/transcriptions')) {
      return jsonResponse({ transcript: 'hello from the clip', lang: 'en' });
    }
    if (url.includes('/video/queue')) {
      return jsonResponse({ queue_id: 'q-1', model: body.model });
    }
    if (url.includes('/models?type=video')) {
      return jsonResponse({
        data: [{ id: 'veo3-fast-text-to-video', type: 'video' }],
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  try {
    const quote = await quoteVideoGeneration({
      model: 'veo3-fast-text-to-video',
      duration: '5s',
      aspectRatio: '16:9',
    });
    const completed = await completeVideo('q-1', 'veo3-fast-text-to-video');
    const transcript = await transcribeVideo('https://example.com/clip.mp4');
    const generated = await queueVideoGeneration('sunset', {
      model: 'veo3-fast-text-to-video',
      duration: '5s',
      aspectRatio: '16:9',
    });
    const generatedDefault = await queueVideoGeneration('sunset');
    const upscaled = await queueVideoUpscale('https://example.com/clip.mp4', {
      upscaleFactor: 2,
    });
    const models = await listModels({ type: 'video', showSpinner: false });

    assert.equal(quote.quote, 0.12);
    assert.equal(completed.success, true);
    assert.equal(transcript.transcript, 'hello from the clip');
    assert.equal(generated.queue_id, 'q-1');
    assert.equal(generatedDefault.queue_id, 'q-1');
    assert.equal(upscaled.model, 'topaz-video-upscale');
    assert.equal(models[0].id, 'veo3-fast-text-to-video');

    assert.deepEqual(requests[0].body, {
      model: 'veo3-fast-text-to-video',
      duration: '5s',
      aspect_ratio: '16:9',
    });
    assert.deepEqual(requests[1].body, {
      queue_id: 'q-1',
      model: 'veo3-fast-text-to-video',
    });
    assert.deepEqual(requests[2].body, {
      url: 'https://example.com/clip.mp4',
      response_format: 'json',
    });
    assert.deepEqual(requests[3].body, {
      model: 'veo3-fast-text-to-video',
      prompt: 'sunset',
      duration: '5s',
      aspect_ratio: '16:9',
    });
    assert.deepEqual(requests[4].body, {
      model: 'wan-2.6-text-to-video',
      prompt: 'sunset',
      duration: '5s',
    });
    assert.equal('aspect_ratio' in requests[4].body, false);
    assert.deepEqual(requests[5].body, {
      model: 'topaz-video-upscale',
      video_url: 'https://example.com/clip.mp4',
      upscale_factor: 2,
    });
    assert.equal('prompt' in requests[5].body, false);
    assert.match(requests[6].url, /\/models\?type=video$/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.VENICE_API_KEY;
    } else {
      process.env.VENICE_API_KEY = originalApiKey;
    }
  }
});

test('retrieveVideo branches on Content-Type and optional cleanup', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  let call = 0;

  process.env.VENICE_API_KEY = 'test-key';

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body && typeof init.body === 'string'
      ? JSON.parse(init.body) as Record<string, unknown>
      : {};
    requests.push({ url, body });
    call += 1;

    if (call === 1) {
      return new Response(JSON.stringify({ status: 'PROCESSING' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const bytes = Buffer.alloc(16);
    bytes.write('ftyp', 4, 'ascii');
    return new Response(bytes, {
      headers: { 'Content-Type': 'video/mp4' },
    });
  }) as typeof fetch;

  try {
    const processing = await retrieveVideo('q-1', 'wan-2.6-text-to-video');
    const completed = await retrieveVideo('q-1', 'wan-2.6-text-to-video', {
      deleteOnCompletion: true,
    });

    assert.deepEqual(processing, { kind: 'status', status: { status: 'PROCESSING' } });
    assert.equal(completed.kind, 'video');
    if (completed.kind === 'video') {
      assert.equal(completed.contentType, 'video/mp4');
      assert.equal(completed.bytes.subarray(4, 8).toString('ascii'), 'ftyp');
    }

    assert.equal(requests[0].body.delete_media_on_completion, false);
    assert.equal(requests[1].body.delete_media_on_completion, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.VENICE_API_KEY;
    } else {
      process.env.VENICE_API_KEY = originalApiKey;
    }
  }
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}
