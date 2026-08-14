import * as fs from 'fs';
import * as path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';

const MB = 1024 * 1024;

export const MAX_IMAGE_DOWNLOAD_BYTES = 50 * MB;
export const MAX_VIDEO_DOWNLOAD_BYTES = 1024 * MB;
export const MAX_UPSCALE_IMAGE_BYTES = 25 * MB;
export const MAX_TRANSCRIPTION_AUDIO_BYTES = 200 * MB;
export const MAX_VIDEO_REFERENCE_IMAGE_BYTES = 20 * MB;
export const MAX_CHAT_IMAGE_BYTES = 20 * MB;
export const MAX_CHAT_FILE_BYTES = 25 * MB;
export const MAX_CHAT_AUDIO_BYTES = 25 * MB;
export const MAX_CHAT_VIDEO_BYTES = 50 * MB;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 120000;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export function assertFileSizeWithinLimit(
  filePath: string,
  maxBytes: number,
  label: string
): number {
  const stats = fs.statSync(filePath);

  if (stats.size > maxBytes) {
    throw new Error(
      `${label} is too large (${formatBytes(stats.size)}). ` +
      `Maximum allowed size is ${formatBytes(maxBytes)}.`
    );
  }

  return stats.size;
}

export function mimeTypeFromPath(filePath: string, fallback = 'application/octet-stream'): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeByExtension: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.mp4': 'video/mp4',
    '.mpeg': 'video/mpeg',
    '.mpg': 'video/mpeg',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.opus': 'audio/opus',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.aiff': 'audio/aiff',
    '.aif': 'audio/aiff',
    '.pdf': 'application/pdf',
    '.epub': 'application/epub+zip',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.csv': 'text/csv',
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.py': 'text/x-python',
    '.js': 'text/javascript',
    '.ts': 'text/plain',
    '.c': 'text/x-c',
    '.cpp': 'text/x-c++',
    '.java': 'text/x-java-source',
    '.go': 'text/x-go',
    '.rs': 'text/x-rust',
    '.ps1': 'text/plain',
    '.sh': 'text/x-shellscript',
    '.yaml': 'text/yaml',
    '.yml': 'text/yaml',
    '.sql': 'text/plain',
  };

  return mimeByExtension[ext] || fallback;
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

export async function downloadToFile(
  url: string,
  outputPath: string,
  options: {
    maxBytes: number;
    expectedContentTypePrefixes: string[];
    timeoutMs?: number;
  }
): Promise<{ bytesWritten: number; contentType: string }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let tempPath: string | null = null;

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const contentTypeHeader = response.headers.get('content-type');
    const contentType = contentTypeHeader?.split(';')[0].trim().toLowerCase() || '';
    const expectedPrefixes = options.expectedContentTypePrefixes.map((prefix) => prefix.toLowerCase());

    if (!contentType) {
      throw new Error('Download response missing Content-Type header.');
    }
    if (!expectedPrefixes.some((prefix) => contentType.startsWith(prefix))) {
      throw new Error(
        `Unexpected content type "${contentType}". ` +
        `Expected one of: ${options.expectedContentTypePrefixes.join(', ')}`
      );
    }

    const contentLength = parseContentLength(response.headers.get('content-length'));
    if (contentLength !== null && contentLength > options.maxBytes) {
      throw new Error(
        `Refusing to download ${formatBytes(contentLength)}. ` +
        `Maximum allowed size is ${formatBytes(options.maxBytes)}.`
      );
    }

    if (!response.body) {
      throw new Error('Download response has no body.');
    }

    const outputDir = path.dirname(outputPath);
    fs.mkdirSync(outputDir, { recursive: true });

    tempPath = path.join(
      outputDir,
      `.${path.basename(outputPath)}.${Date.now()}.${Math.random().toString(16).slice(2)}.part`
    );

    let bytesWritten = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytesWritten += chunk.length;
        if (bytesWritten > options.maxBytes) {
          callback(
            new Error(
              `Download exceeded limit of ${formatBytes(options.maxBytes)}. ` +
              'The remote file may be unexpectedly large.'
            )
          );
          return;
        }
        callback(null, chunk);
      },
    });

    await pipeline(
      Readable.fromWeb(response.body as unknown as globalThis.ReadableStream<Uint8Array>),
      limiter,
      fs.createWriteStream(tempPath)
    );

    fs.renameSync(tempPath, outputPath);
    tempPath = null;

    return { bytesWritten, contentType };
  } catch (error) {
    if (tempPath && fs.existsSync(tempPath)) {
      fs.rmSync(tempPath, { force: true });
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Download timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function readFileAsBase64(
  filePath: string,
  maxBytes: number,
  label: string
): { base64: string; mimeType: string; filename: string } {
  assertFileSizeWithinLimit(filePath, maxBytes, label);
  const buffer = fs.readFileSync(filePath);
  return {
    base64: buffer.toString('base64'),
    mimeType: mimeTypeFromPath(filePath),
    filename: path.basename(filePath),
  };
}

export function readFileAsDataUrl(
  filePath: string,
  maxBytes: number,
  label: string
): { dataUrl: string; mimeType: string; filename: string } {
  const file = readFileAsBase64(filePath, maxBytes, label);
  return {
    dataUrl: `data:${file.mimeType};base64,${file.base64}`,
    mimeType: file.mimeType,
    filename: file.filename,
  };
}

export function audioFormatFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const formatByExtension: Record<string, string> = {
    '.wav': 'wav',
    '.mp3': 'mp3',
    '.aiff': 'aiff',
    '.aif': 'aiff',
    '.aac': 'aac',
    '.ogg': 'ogg',
    '.flac': 'flac',
    '.m4a': 'm4a',
  };
  return formatByExtension[ext] || 'wav';
}

export async function downloadToBuffer(
  url: string,
  options: {
    maxBytes: number;
    timeoutMs?: number;
  }
): Promise<{ buffer: Buffer; contentType: string }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const contentTypeHeader = response.headers.get('content-type');
    const contentType = contentTypeHeader?.split(';')[0].trim().toLowerCase() || 'application/octet-stream';
    const contentLength = parseContentLength(response.headers.get('content-length'));
    if (contentLength !== null && contentLength > options.maxBytes) {
      throw new Error(
        `Refusing to download ${formatBytes(contentLength)}. ` +
        `Maximum allowed size is ${formatBytes(options.maxBytes)}.`
      );
    }

    if (!response.body) {
      throw new Error('Download response has no body.');
    }

    const chunks: Buffer[] = [];
    let bytesWritten = 0;
    for await (const chunk of Readable.fromWeb(
      response.body as unknown as globalThis.ReadableStream<Uint8Array>
    )) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytesWritten += buffer.length;
      if (bytesWritten > options.maxBytes) {
        throw new Error(
          `Download exceeded limit of ${formatBytes(options.maxBytes)}. ` +
          'The remote file may be unexpectedly large.'
        );
      }
      chunks.push(buffer);
    }

    return { buffer: Buffer.concat(chunks), contentType };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Download timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
