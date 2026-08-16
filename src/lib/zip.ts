/**
 * Minimal dependency-free ZIP archive support for debug session exports
 * (VC-KIMI-059). Entries are stored with the DEFLATE method, which every ZIP
 * reader understands, and CRC-32 checksums are included for integrity.
 */

import { deflateRawSync, inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  data: Buffer;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2));
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: dosDate };
}

function writeU16(buffer: Buffer, offset: number, value: number): void {
  buffer.writeUInt16LE(value & 0xffff, offset);
}

function writeU32(buffer: Buffer, offset: number, value: number): void {
  buffer.writeUInt32LE(value >>> 0, offset);
}

/**
 * Build a ZIP archive (DEFLATE) from the given entries.
 */
export function createZip(entries: ZipEntry[]): Buffer {
  const now = new Date();
  const { time, date } = dosDateTime(now);

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf-8');
    const compressed = deflateRawSync(entry.data);
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30 + name.length);
    writeU32(local, 0, 0x04034b50);
    writeU16(local, 4, 20);
    writeU16(local, 6, 0);
    writeU16(local, 8, 8); // DEFLATE
    writeU16(local, 10, time);
    writeU16(local, 12, date);
    writeU32(local, 14, crc);
    writeU32(local, 18, compressed.length);
    writeU32(local, 22, entry.data.length);
    writeU16(local, 26, name.length);
    writeU16(local, 28, 0);
    name.copy(local, 30);
    localParts.push(local, compressed);

    const central = Buffer.alloc(46 + name.length);
    writeU32(central, 0, 0x02014b50);
    writeU16(central, 4, 20);
    writeU16(central, 6, 20);
    writeU16(central, 8, 0);
    writeU16(central, 10, 8);
    writeU16(central, 12, time);
    writeU16(central, 14, date);
    writeU32(central, 16, crc);
    writeU32(central, 20, compressed.length);
    writeU32(central, 24, entry.data.length);
    writeU16(central, 28, name.length);
    writeU16(central, 30, 0);
    writeU16(central, 32, 0);
    writeU16(central, 34, 0);
    writeU16(central, 36, 0);
    writeU32(central, 38, 0);
    writeU32(central, 42, offset);
    name.copy(central, 46);
    centralParts.push(central);

    offset += local.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  writeU32(end, 0, 0x06054b50);
  writeU16(end, 4, 0);
  writeU16(end, 6, 0);
  writeU16(end, 8, entries.length);
  writeU16(end, 10, entries.length);
  writeU32(end, 12, centralDir.length);
  writeU32(end, 16, offset);
  writeU16(end, 20, 0);

  return Buffer.concat([...localParts, centralDir, end]);
}

/** True when the buffer begins with the ZIP local-file-header signature. */
export function isZipArchive(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50;
}

/**
 * Extract a single named entry from a ZIP archive. Returns undefined when the
 * entry (or the archive structure) is not found or is malformed.
 */
export function readZipEntry(zip: Buffer, name: string): Buffer | undefined {
  if (zip.length < 22 || zip.readUInt32LE(0) !== 0x04034b50) return undefined;

  // Locate the end-of-central-directory record by scanning backwards.
  let endOffset = -1;
  const scanStart = Math.max(0, zip.length - 22 - 0xffff);
  for (let i = zip.length - 22; i >= scanStart; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      endOffset = i;
      break;
    }
  }
  if (endOffset < 0) return undefined;

  const entryCount = zip.readUInt16LE(endOffset + 10);
  let cursor = zip.readUInt32LE(endOffset + 16);

  for (let i = 0; i < entryCount; i++) {
    if (cursor + 46 > zip.length || zip.readUInt32LE(cursor) !== 0x02014b50) return undefined;
    const method = zip.readUInt16LE(cursor + 10);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const entryName = zip.slice(cursor + 46, cursor + 46 + nameLength).toString('utf-8');

    if (entryName === name) {
      if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== 0x04034b50) return undefined;
      const localNameLength = zip.readUInt16LE(localOffset + 26);
      const localExtraLength = zip.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const data = zip.slice(dataStart, dataStart + compressedSize);
      if (method === 8) return inflateRawSync(data);
      if (method === 0) return data;
      return undefined;
    }

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return undefined;
}
