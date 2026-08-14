import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyVideoRetrieveContentType,
  getVideoStatus,
  queueVideoGeneration,
  retrieveVideo,
} from './api.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

test('classifyVideoRetrieveContentType branches on JSON vs video', () => {
  assert.equal(classifyVideoRetrieveContentType('application/json'), 'json');
  assert.equal(classifyVideoRetrieveContentType('application/json; charset=utf-8'), 'json');
  assert.equal(classifyVideoRetrieveContentType('video/mp4'), 'video');
  assert.equal(classifyVideoRetrieveContentType('application/octet-stream'), 'video');
  assert.equal(classifyVideoRetrieveContentType('text/plain'), 'unknown');
});

test('queueVideoGeneration omits aspect_ratio unless the user set it', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;
  const bodies: unknown[] = [];

  process.env.VENICE_API_KEY = 'test-key';
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return jsonResponse({ queue_id: 'q1', model: 'wan-2.6-image-to-video' });
  }) as typeof fetch;

  try {
    await queueVideoGeneration('a man stands up', {
      model: 'wan-2.6-image-to-video',
      duration: '5s',
      imageUrl: 'data:image/jpeg;base64,abc',
    });
    await queueVideoGeneration('sunset', {
      model: 'wan-2.6-text-to-video',
      aspectRatio: '16:9',
    });

    assert.deepEqual(bodies[0], {
      model: 'wan-2.6-image-to-video',
      prompt: 'a man stands up',
      duration: '5s',
      image_url: 'data:image/jpeg;base64,abc',
    });
    assert.equal('aspect_ratio' in (bodies[0] as object), false);
    assert.deepEqual(bodies[1], {
      model: 'wan-2.6-text-to-video',
      prompt: 'sunset',
      duration: '5s',
      aspect_ratio: '16:9',
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.VENICE_API_KEY;
    } else {
      process.env.VENICE_API_KEY = originalApiKey;
    }
  }
});

test('video status treats a completed MP4 body as completed', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;
  const mp4 = Buffer.from('xxxxftypisom');

  process.env.VENICE_API_KEY = 'test-key';
  globalThis.fetch = (async () => new Response(mp4, {
    headers: { 'Content-Type': 'video/mp4' },
  })) as typeof fetch;

  try {
    const status = await getVideoStatus('q1', 'kling-v3-pro-image-to-video');
    assert.equal(status.status, 'completed');

    const retrieved = await retrieveVideo('q1', 'kling-v3-pro-image-to-video');
    assert.equal(retrieved.kind, 'video');
    if (retrieved.kind === 'video') {
      assert.equal(retrieved.bytes.equals(mp4), true);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.VENICE_API_KEY;
    } else {
      process.env.VENICE_API_KEY = originalApiKey;
    }
  }
});

test('video status still parses JSON while a job is processing', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;

  process.env.VENICE_API_KEY = 'test-key';
  globalThis.fetch = (async () => jsonResponse({
    status: 'PROCESSING',
    average_execution_time: 10000,
    execution_duration: 1000,
  })) as typeof fetch;

  try {
    const status = await getVideoStatus('q1', 'kling-v3-pro-image-to-video');
    assert.equal(status.status, 'PROCESSING');
    assert.equal(status.execution_duration, 1000);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.VENICE_API_KEY;
    } else {
      process.env.VENICE_API_KEY = originalApiKey;
    }
  }
});
