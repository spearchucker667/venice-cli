import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inspectImageArtifact } from './io.js';

describe('Venice image artifact custody', () => {
  it('reports PNG encoding and dimensions from bytes', () => {
    const bytes = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
    bytes.writeUInt32BE(512, 16);
    bytes.writeUInt32BE(256, 20);
    assert.deepEqual(inspectImageArtifact('art.png', bytes), {
      path: 'art.png', format: 'png', width: 512, height: 256, bytes: 24,
    });
  });

  it('rejects mislabeled image bytes before writing', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    assert.throws(() => inspectImageArtifact('art.png', jpeg), /JPEG bytes for a PNG output path/);
  });

  it('rejects unknown bytes and unsupported extensions', () => {
    assert.throws(() => inspectImageArtifact('art.png', Buffer.from('not an image')), /unrecognized image bytes/);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.throws(() => inspectImageArtifact('art.bin', png), /must end in/);
  });
});
