import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Command } from 'commander';
import { parseImageGenerationOptions, registerImageCommand } from './image.js';
import { buildImageGenerationBody } from '../lib/api.js';

const baseOptions = {
  count: '1',
  styleReference: [],
};

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);

async function runImageCommand(args: string[]): Promise<string[]> {
  const output: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => output.push(values.join(' '));

  try {
    const program = new Command();
    registerImageCommand(program);
    await program.parseAsync(['node', 'venice', ...args]);
    return output;
  } finally {
    console.log = originalLog;
  }
}

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

test('upscale JSON returns base64 without files while pretty output writes a file', async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VENICE_API_KEY;
  const originalCwd = process.cwd();
  const tempDir = mkdtempSync(join(tmpdir(), 'venice-upscale-cli-test-'));
  const inputPath = join(tempDir, 'input.png');
  const ignoredOutputPath = join(tempDir, 'ignored.png');
  const prettyOutputPath = join(tempDir, 'pretty.png');

  writeFileSync(inputPath, PNG_BYTES);
  process.env.VENICE_API_KEY = 'test-key';
  process.chdir(tempDir);
  globalThis.fetch = (async () => new Response(PNG_BYTES, {
    headers: { 'Content-Type': 'image/png' },
  })) as typeof fetch;

  try {
    const jsonOutput = await runImageCommand([
      'upscale',
      inputPath,
      '--format',
      'json',
      '--output',
      ignoredOutputPath,
    ]);
    const parsed = JSON.parse(jsonOutput.join('\n')) as {
      images: Array<{ b64_json: string; content_type: string; bytes: number }>;
    };

    assert.deepEqual(parsed, {
      images: [{
        b64_json: PNG_BYTES.toString('base64'),
        content_type: 'image/png',
        bytes: PNG_BYTES.length,
      }],
    });
    assert.equal(existsSync(ignoredOutputPath), false);
    assert.deepEqual(readdirSync(tempDir), ['input.png']);

    await runImageCommand([
      'upscale',
      inputPath,
      '--format',
      'pretty',
      '--output',
      prettyOutputPath,
    ]);
    assert.equal(readFileSync(prettyOutputPath).equals(PNG_BYTES), true);
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
    if (originalApiKey === undefined) {
      delete process.env.VENICE_API_KEY;
    } else {
      process.env.VENICE_API_KEY = originalApiKey;
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('image-styles honors its output format option', async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const output: string[] = [];

  globalThis.fetch = async (): Promise<Response> =>
    Response.json({ data: ['Cinematic'], object: 'list' });
  console.log = (...values: unknown[]) => {
    output.push(values.map(String).join(' '));
  };

  try {
    const program = new Command();
    program.exitOverride();
    registerImageCommand(program);
    await program.parseAsync(['node', 'venice', 'image-styles', '--format', 'json']);

    assert.deepEqual(JSON.parse(output.join('\n')), {
      data: ['Cinematic'],
      object: 'list',
    });
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }
});

test('image generation accepts prompts beginning with editing command words', async () => {
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const originalApiKey = process.env.VENICE_API_KEY;
  let requestBody: Record<string, unknown> = {};
  process.env.VENICE_API_KEY = 'test-key';

  globalThis.fetch = async (_input, init): Promise<Response> => {
    requestBody = JSON.parse(String(init?.body));
    return Response.json({ id: 'image-id', images: ['generated-image'] });
  };
  console.log = () => {};

  try {
    const program = new Command();
    program.exitOverride();
    registerImageCommand(program);
    await program.parseAsync([
      'node',
      'venice',
      'image',
      'edit',
      'the',
      'lighting',
      '--format',
      'json',
    ]);

    assert.equal(requestBody.prompt, 'edit the lighting');
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    if (originalApiKey === undefined) {
      delete process.env.VENICE_API_KEY;
    } else {
      process.env.VENICE_API_KEY = originalApiKey;
    }
  }
});
