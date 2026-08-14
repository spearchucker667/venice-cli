import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  editImage,
  generateImage,
  listImageStyles,
  multiEditImage,
  removeImageBackground,
} from './api.js';

test('image APIs send the endpoint-specific payloads', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'venice-image-api-test-'));
  const firstImage = join(tempDir, 'first.png');
  const secondImage = join(tempDir, 'second.jpg');
  writeFileSync(firstImage, 'first image');
  writeFileSync(secondImage, 'second image');

  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  process.env.VENICE_API_KEY = 'test-key';

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    requests.push({ url, init });

    if (url.endsWith('/image/generate')) {
      return Response.json({ id: 'generated', images: ['generated-image'] });
    }
    if (url.endsWith('/image/styles')) {
      return Response.json({ data: ['Cinematic', 'Comic Book'], object: 'list' });
    }
    return new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'Content-Type': 'image/png' },
    });
  };

  try {
    assert.deepEqual(
      await generateImage('A canal', { model: 'test-model', stylePreset: 'Cinematic' }),
      ['generated-image']
    );
    assert.deepEqual(
      new Uint8Array(await editImage(firstImage, 'Remove the sign', {
        enhancePrompt: true,
        safeMode: false,
      })),
      new Uint8Array([1, 2, 3])
    );
    await multiEditImage([firstImage, secondImage], 'Combine them', { model: 'layer-model' });
    await removeImageBackground(firstImage);
    assert.deepEqual(await listImageStyles(), ['Cinematic', 'Comic Book']);

    const requestFor = (suffix: string) => {
      const request = requests.find(({ url }) => url.endsWith(suffix));
      assert.ok(request, `Missing request for ${suffix}`);
      return request;
    };
    const bodyFor = (suffix: string): Record<string, unknown> =>
      JSON.parse(String(requestFor(suffix).init?.body));

    assert.equal(bodyFor('/image/generate').style_preset, 'Cinematic');
    assert.deepEqual(bodyFor('/image/edit'), {
      image: Buffer.from('first image').toString('base64'),
      prompt: 'Remove the sign',
      enhance_prompt: true,
      safe_mode: false,
    });
    assert.deepEqual(bodyFor('/image/multi-edit'), {
      images: [
        Buffer.from('first image').toString('base64'),
        Buffer.from('second image').toString('base64'),
      ],
      prompt: 'Combine them',
      modelId: 'layer-model',
    });
    assert.deepEqual(bodyFor('/image/background-remove'), {
      image: Buffer.from('first image').toString('base64'),
    });
    assert.equal(
      (requestFor('/image/styles').init?.headers as Record<string, string>).Authorization,
      undefined
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

test('multi-edit rejects more than three images before requesting', async () => {
  await assert.rejects(
    multiEditImage(['one', 'two', 'three', 'four'], 'Prompt'),
    /between 1 and 3 images/
  );
});
