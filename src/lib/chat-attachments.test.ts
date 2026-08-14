import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  assertAttachmentCapabilities,
  assertAttachmentsAllowedForPrivacy,
  assertLocalAttachmentFiles,
  buildUserMessageContent,
  hasChatAttachments,
  parseChatAttachments,
} from './chat-attachments.js';
import { messageContentToText } from '../types/index.js';
import type { Model } from '../types/index.js';

const visionModel: Model = {
  id: 'qwen3-vl-235b-a22b',
  type: 'text',
  model_spec: {
    capabilities: {
      supportsVision: true,
      supportsMultipleImages: true,
      maxImages: 4,
      supportsAudioInput: true,
      supportsVideoInput: true,
      maxVideos: 3,
    },
  },
};

test('parseChatAttachments and hasChatAttachments handle missing and present flags', () => {
  assert.equal(hasChatAttachments(parseChatAttachments({})), false);
  assert.equal(
    hasChatAttachments(parseChatAttachments({ image: ['photo.jpg'] })),
    true
  );
});

test('assertLocalAttachmentFiles rejects missing local files before any API call', () => {
  assert.throws(
    () => assertLocalAttachmentFiles({
      images: [join(tmpdir(), 'venice-missing-image.jpg')],
      files: [],
      audio: [],
      videos: [],
    }),
    /Image not found/
  );
});

test('assertAttachmentCapabilities requires advertised vision/audio/video support', () => {
  assert.throws(
    () => assertAttachmentCapabilities(
      { id: 'kimi-k2-5' },
      { images: ['photo.jpg'], files: [], audio: [], videos: [] }
    ),
    /supportsVision/
  );

  assert.doesNotThrow(() => assertAttachmentCapabilities(
    visionModel,
    { images: ['a.jpg', 'b.jpg'], files: [], audio: [], videos: [] }
  ));

  assert.throws(
    () => assertAttachmentCapabilities(
      { id: 'single-image', model_spec: { capabilities: { supportsVision: true } } },
      { images: ['a.jpg', 'b.jpg'], files: [], audio: [], videos: [] }
    ),
    /supportsMultipleImages/
  );
});

test('assertAttachmentsAllowedForPrivacy rejects E2EE and TEE', () => {
  assert.throws(() => assertAttachmentsAllowedForPrivacy(true, false), /E2EE or TEE/);
  assert.throws(() => assertAttachmentsAllowedForPrivacy(false, true), /E2EE or TEE/);
  assert.doesNotThrow(() => assertAttachmentsAllowedForPrivacy(false, false));
});

test('buildUserMessageContent keeps text-only prompts as strings', async () => {
  const content = await buildUserMessageContent('hello', {
    images: [],
    files: [],
    audio: [],
    videos: [],
  });
  assert.equal(content, 'hello');
});

test('buildUserMessageContent encodes local images as data URLs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'venice-attach-'));
  const imagePath = join(dir, 'dot.png');
  writeFileSync(imagePath, Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  ));

  try {
    const content = await buildUserMessageContent('what is in this picture?', {
      images: [imagePath],
      files: [],
      audio: [],
      videos: [],
    });
    assert.ok(Array.isArray(content));
    assert.equal(content[0].type, 'text');
    assert.equal(content[1].type, 'image_url');
    if (content[1].type === 'image_url') {
      assert.match(content[1].image_url.url, /^data:image\/png;base64,/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildUserMessageContent passes through remote URLs', async () => {
  const content = await buildUserMessageContent('describe this clip', {
    images: [],
    files: ['https://example.com/report.pdf'],
    audio: [],
    videos: ['https://example.com/clip.mp4'],
  });
  assert.ok(Array.isArray(content));
  assert.deepEqual(content[1], {
    type: 'file',
    file: {
      file_data: 'https://example.com/report.pdf',
      filename: 'report.pdf',
    },
  });
  assert.deepEqual(content[2], {
    type: 'video_url',
    video_url: { url: 'https://example.com/clip.mp4' },
  });
});

test('messageContentToText summarizes multimodal parts', () => {
  assert.equal(
    messageContentToText([
      { type: 'text', text: 'summarize' },
      { type: 'file', file: { file_data: 'https://example.com/a.pdf', filename: 'a.pdf' } },
    ]),
    'summarize [file: a.pdf]'
  );
});
