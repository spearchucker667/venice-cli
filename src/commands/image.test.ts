import assert from 'node:assert/strict';
import test from 'node:test';
import { parseImageGenerationOptions } from './image.js';
import { buildImageGenerationBody } from '../lib/api.js';

const baseOptions = {
  count: '1',
  styleReference: [],
};

test('does not force pixel dimensions when no sizing flags are provided', () => {
  const options = parseImageGenerationOptions(baseOptions);
  const body = buildImageGenerationBody('a canal at sunset', options);

  assert.equal('width' in body, false);
  assert.equal('height' in body, false);
  assert.equal('style_references' in body, false);
  assert.equal(body.variants, undefined);
});

test('maps ratio-tier and advanced generation options to API fields', () => {
  const options = parseImageGenerationOptions({
    ...baseOptions,
    model: 'nano-banana-pro',
    aspectRatio: '16:9',
    resolution: '2k',
    quality: 'MEDIUM',
    style: '3D Model',
    styleReference: ['https://example.com/style.png::0.75'],
    negative: 'clouds, rain',
    seed: '123',
    cfgScale: '7.5',
    steps: '12',
    loraStrength: '50',
    hideWatermark: true,
    safeMode: false,
    embedExifMetadata: true,
    count: '2',
  });

  assert.deepEqual(buildImageGenerationBody('a canal at sunset', options), {
    model: 'nano-banana-pro',
    prompt: 'a canal at sunset',
    format: 'png',
    aspect_ratio: '16:9',
    resolution: '2K',
    quality: 'medium',
    style_preset: '3D Model',
    style_references: [{ image: 'https://example.com/style.png', strength: 0.75 }],
    negative_prompt: 'clouds, rain',
    seed: 123,
    cfg_scale: 7.5,
    steps: 12,
    lora_strength: 50,
    hide_watermark: true,
    safe_mode: false,
    embed_exif_metadata: true,
    variants: 2,
  });
});

test('rejects mixed sizing modes', () => {
  assert.throws(
    () => parseImageGenerationOptions({
      ...baseOptions,
      width: '1024',
      height: '1024',
      aspectRatio: '1:1',
    }),
    /sizing modes cannot be combined/
  );
});

test('requires paired pixel dimensions and an aspect ratio for resolution', () => {
  assert.throws(
    () => parseImageGenerationOptions({ ...baseOptions, width: '1024' }),
    /Width and height must be provided together/
  );
  assert.throws(
    () => parseImageGenerationOptions({ ...baseOptions, resolution: '4K' }),
    /Resolution requires --aspect-ratio/
  );
});

test('validates enum and numeric generation options', () => {
  assert.throws(
    () => parseImageGenerationOptions({ ...baseOptions, quality: 'ultra' }),
    /Quality must be one of/
  );
  assert.throws(
    () => parseImageGenerationOptions({ ...baseOptions, cfgScale: '21' }),
    /CFG scale must be/
  );
  assert.throws(
    () => parseImageGenerationOptions({ ...baseOptions, cfgScale: '0' }),
    /CFG scale must be/
  );
  assert.throws(
    () => parseImageGenerationOptions({ ...baseOptions, cfgScale: '-1' }),
    /CFG scale must be/
  );
  assert.throws(
    () => parseImageGenerationOptions({ ...baseOptions, seed: '1.5' }),
    /Seed must be an integer/
  );
  assert.throws(
    () => parseImageGenerationOptions({
      ...baseOptions,
      styleReference: ['https://example.com/style.png::2'],
    }),
    /Style reference strength must be/
  );
});

test('preserves IPv6 style reference URLs without a strength suffix', () => {
  const options = parseImageGenerationOptions({
    ...baseOptions,
    styleReference: ['http://[::1]/style.png'],
  });

  assert.deepEqual(options.styleReferences, [{ image: 'http://[::1]/style.png' }]);
});

test('rejects a blank aspect ratio', () => {
  assert.throws(
    () => parseImageGenerationOptions({ ...baseOptions, aspectRatio: '   ' }),
    /Aspect ratio must not be blank/
  );
});

test('trims resolution and quality and rejects blank values', () => {
  const options = parseImageGenerationOptions({
    ...baseOptions,
    aspectRatio: '16:9',
    resolution: ' 2k ',
    quality: ' medium ',
  });

  assert.equal(options.resolution, '2K');
  assert.equal(options.quality, 'medium');
  assert.throws(
    () => parseImageGenerationOptions({
      ...baseOptions,
      aspectRatio: '1:1',
      resolution: ' ',
    }),
    /Resolution must not be blank/
  );
  assert.throws(
    () => parseImageGenerationOptions({ ...baseOptions, quality: ' ' }),
    /Quality must not be blank/
  );
});
