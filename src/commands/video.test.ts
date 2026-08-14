import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FALLBACK_VIDEO_MODELS,
  isPublicHttpUrl,
  parseUpscaleFactor,
  requirePublicVideoUrl,
  videoModelKind,
} from './video.js';

test('isPublicHttpUrl accepts only http(s) URLs', () => {
  assert.equal(isPublicHttpUrl('https://example.com/clip.mp4'), true);
  assert.equal(isPublicHttpUrl('http://example.com/clip.mp4'), true);
  assert.equal(isPublicHttpUrl('file:///tmp/clip.mp4'), false);
  assert.equal(isPublicHttpUrl('clip.mp4'), false);
  assert.equal(isPublicHttpUrl('/tmp/clip.mp4'), false);
});

test('requirePublicVideoUrl rejects local files with a clear error', () => {
  assert.equal(
    requirePublicVideoUrl('https://example.com/clip.mp4'),
    'https://example.com/clip.mp4'
  );
  assert.throws(
    () => requirePublicVideoUrl('clip.mp4'),
    /public HTTP\(S\) URL/
  );
});

test('parseUpscaleFactor accepts 1, 2, and 4', () => {
  assert.equal(parseUpscaleFactor('2'), 2);
  assert.equal(parseUpscaleFactor(4), 4);
  assert.equal(parseUpscaleFactor(undefined), 2);
  assert.throws(() => parseUpscaleFactor('3'), /1, 2, or 4/);
});

test('videoModelKind infers generation family from the model id', () => {
  assert.equal(videoModelKind('veo3-fast-text-to-video'), 'text-to-video');
  assert.equal(videoModelKind('wan-2.6-image-to-video'), 'image-to-video');
  assert.equal(videoModelKind('topaz-video-upscale'), 'upscale');
  assert.equal(videoModelKind('custom-live-model'), 'video');
});

test('fallback video models stay small and include upscale', () => {
  assert.ok(FALLBACK_VIDEO_MODELS.length <= 8);
  assert.ok(FALLBACK_VIDEO_MODELS.some((model) => model.id === 'topaz-video-upscale'));
});
