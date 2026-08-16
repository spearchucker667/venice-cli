import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createZip, readZipEntry, isZipArchive, crc32 } from './zip.js';

describe('zip', () => {
  it('round-trips multiple entries', () => {
    const zip = createZip([
      { name: 'session.json', data: Buffer.from('{"sessionId":"s1"}') },
      { name: 'messages.jsonl', data: Buffer.from('line1\nline2\n') },
    ]);
    assert.ok(isZipArchive(zip));
    assert.strictEqual(readZipEntry(zip, 'session.json')?.toString('utf-8'), '{"sessionId":"s1"}');
    assert.strictEqual(readZipEntry(zip, 'messages.jsonl')?.toString('utf-8'), 'line1\nline2\n');
    assert.strictEqual(readZipEntry(zip, 'missing.txt'), undefined);
  });

  it('preserves binary content and computes a stable CRC-32', () => {
    const payload = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const zip = createZip([{ name: 'blob.bin', data: payload }]);
    const extracted = readZipEntry(zip, 'blob.bin');
    assert.ok(extracted);
    assert.deepStrictEqual(Buffer.from(extracted), payload);
    assert.strictEqual(crc32(payload), crc32(Buffer.from(payload)));
  });

  it('rejects non-zip input gracefully', () => {
    assert.strictEqual(isZipArchive(Buffer.from('not a zip')), false);
    assert.strictEqual(readZipEntry(Buffer.from('not a zip'), 'x'), undefined);
  });
});
