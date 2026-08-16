import { describe, it } from 'node:test';
import assert from 'node:assert';
import { editImageTool, generateImageTool, removeBackgroundTool, upscaleImageTool } from './image.js';

describe('Venice image tools', () => {
  it('generate_image has correct schema and risk', () => {
    assert.strictEqual(generateImageTool.name, 'generate_image');
    assert.strictEqual(generateImageTool.risk, 'network');
    assert.ok(generateImageTool.inputSchema.required?.includes('prompt'));
    assert.ok(generateImageTool.inputSchema.required?.includes('output'));
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
});
