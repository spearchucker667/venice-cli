import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { editImageTool, generateImageTool, removeBackgroundTool, upscaleImageTool } from './image.js';

describe('Venice image tools', () => {
  afterEach(() => {
    delete process.env.VENICE_API_KEY;
  });

  it('generate_image has correct schema and risk', () => {
    assert.strictEqual(generateImageTool.name, 'generate_image');
    assert.strictEqual(generateImageTool.risk, 'network');
    assert.ok(generateImageTool.inputSchema.required?.includes('prompt'));
    assert.ok(generateImageTool.inputSchema.required?.includes('output'));
    assert.ok('format' in generateImageTool.inputSchema.properties);
  });

  it('edit_image has correct schema and risk', () => {
    assert.strictEqual(editImageTool.name, 'edit_image');
    assert.strictEqual(editImageTool.risk, 'network');
    assert.deepStrictEqual(editImageTool.inputSchema.required, ['image', 'prompt', 'output']);
  });

  it('upscale_image has correct schema and risk', () => {
    assert.strictEqual(upscaleImageTool.name, 'upscale_image');
    assert.strictEqual(upscaleImageTool.risk, 'network');
    assert.deepStrictEqual(upscaleImageTool.inputSchema.required, ['image', 'output']);
  });

  it('remove_background has correct schema and risk', () => {
    assert.strictEqual(removeBackgroundTool.name, 'remove_background');
    assert.strictEqual(removeBackgroundTool.risk, 'network');
    assert.deepStrictEqual(removeBackgroundTool.inputSchema.required, ['image', 'output']);
  });

  it('a pre-aborted turn signal prevents generate_image from writing output (R2-005)', async () => {
    const originalFetch = globalThis.fetch;
    process.env.VENICE_API_KEY = 'test-key';
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-img-cancel-')));

    const controller = new AbortController();
    controller.abort();

    // Mimic native fetch: an already-aborted request signal rejects with an
    // AbortError before any network I/O.
    globalThis.fetch = (async (_input, init) => {
      if (init?.signal?.aborted) {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        throw error;
      }
      return new Response(JSON.stringify({ id: 'img-1', images: ['aGVsbG8='] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const result = await generateImageTool.execute(
        { prompt: 'a cat', output: 'cat.png' },
        {
          workspaceRoot: tmp,
          sessionId: 's1',
          objective: 'cancel',
          runtimeState: {} as never,
          signal: controller.signal,
        }
      );
      assert.strictEqual(result.ok, false, 'an aborted turn must not produce a successful image');
      assert.strictEqual(fs.existsSync(path.join(tmp, 'cat.png')), false, 'no output file may be written after abort');
    } finally {
      globalThis.fetch = originalFetch;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
