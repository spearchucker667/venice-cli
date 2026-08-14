import assert from 'node:assert/strict';
import test from 'node:test';
import type { VideoStatusResult } from '../lib/api.js';
import { classifyVideoStatus, waitForVideoStatus } from './video.js';

test('classifyVideoStatus handles status casing and common terminal aliases', () => {
  assert.equal(classifyVideoStatus('PROCESSING'), 'processing');
  assert.equal(classifyVideoStatus('processing'), 'processing');
  assert.equal(classifyVideoStatus('in-progress'), 'processing');
  assert.equal(classifyVideoStatus('SUCCEEDED'), 'completed');
  assert.equal(classifyVideoStatus('cancelled'), 'failed');
  assert.equal(classifyVideoStatus('unknown'), 'other');
});

test('waitForVideoStatus polls lowercase processing and returns the final response', async () => {
  const responses: VideoStatusResult[] = [
    { status: 'processing', execution_duration: 1000 },
    { status: 'completed', video_url: 'https://example.com/video.mp4' },
  ];
  let fetchCount = 0;

  const result = await waitForVideoStatus(
    async () => {
      const response = responses[fetchCount];
      fetchCount += 1;
      assert.ok(response, 'status was fetched after receiving a terminal response');
      return response;
    },
    1000,
    1
  );

  assert.equal(fetchCount, 2);
  assert.deepEqual(result, responses[1]);
});

test('waitForVideoStatus times out even when a status request does not settle', async () => {
  await assert.rejects(
    waitForVideoStatus(
      () => new Promise<VideoStatusResult>(() => undefined),
      10,
      1
    ),
    /Timed out waiting for video generation/
  );
});
