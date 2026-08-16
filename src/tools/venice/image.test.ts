import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateImageTool } from './image.js';

describe('Venice image tools', () => {
  it('generate_image has correct schema and risk', () => {
    assert.strictEqual(generateImageTool.name, 'generate_image');
    assert.strictEqual(generateImageTool.risk, 'network');
    assert.ok(generateImageTool.inputSchema.required?.includes('prompt'));
    assert.ok(generateImageTool.inputSchema.required?.includes('output'));
  });
});
