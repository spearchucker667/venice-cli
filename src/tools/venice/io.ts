/**
 * Workspace output helpers for Venice media tools.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { WorkspaceManager } from '../../agent/workspace.js';

export function resolveWorkspaceFile(
  workspaceRoot: string,
  inputPath: string,
  additionalRoots?: string[]
): { absolute: string; relative: string } {
  const workspace = new WorkspaceManager(workspaceRoot, additionalRoots ?? []);
  return workspace.resolve(inputPath);
}

export function writeWorkspaceBytes(
  workspaceRoot: string,
  outputPath: string,
  bytes: Buffer | ArrayBuffer,
  additionalRoots?: string[]
): { absolute: string; relative: string } {
  const workspace = new WorkspaceManager(workspaceRoot, additionalRoots ?? []);
  const resolved = workspace.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolved.absolute), { recursive: true });
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(new Uint8Array(bytes));
  fs.writeFileSync(resolved.absolute, buffer);
  return resolved;
}

export interface ImageArtifact {
  path: string;
  format: 'png' | 'jpeg' | 'webp';
  width?: number;
  height?: number;
  bytes: number;
}

export function inspectImageArtifact(outputPath: string, bytes: Buffer | ArrayBuffer): ImageArtifact {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(new Uint8Array(bytes));
  const format = detectImageFormat(buffer);
  if (!format) throw new Error('Venice returned unrecognized image bytes');
  const expected = imageFormatForPath(outputPath);
  if (!expected) throw new Error('Image output path must end in .png, .jpg, .jpeg, or .webp');
  if (format !== expected) {
    throw new Error(`Venice returned ${format.toUpperCase()} bytes for a ${expected.toUpperCase()} output path; file was not written`);
  }
  const dimensions = imageDimensions(buffer, format);
  return { path: outputPath.replaceAll('\\', '/'), format, ...dimensions, bytes: buffer.length };
}

export function imageFormatForPath(outputPath: string): 'png' | 'jpeg' | 'webp' | undefined {
  switch (path.extname(outputPath).toLowerCase()) {
    case '.png': return 'png';
    case '.jpg':
    case '.jpeg': return 'jpeg';
    case '.webp': return 'webp';
    default: return undefined;
  }
}

function detectImageFormat(bytes: Buffer): ImageArtifact['format'] | undefined {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return undefined;
}

function imageDimensions(bytes: Buffer, format: ImageArtifact['format']): { width?: number; height?: number } {
  if (format === 'png' && bytes.length >= 24) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (format === 'jpeg') {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset++; continue; }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  return {};
}
