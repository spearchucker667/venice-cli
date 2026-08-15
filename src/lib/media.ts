import * as fs from 'fs';
import * as path from 'path';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStreamReadResult } from 'stream/web';

const MB = 1024 * 1024;

export const MAX_IMAGE_DOWNLOAD_BYTES = 50 * MB;
export const MAX_IMAGE_EDIT_BYTES = 25 * MB;
export const MAX_AUDIO_DOWNLOAD_BYTES = 500 * MB;
export const MAX_VIDEO_DOWNLOAD_BYTES = 1024 * MB;
export const MAX_UPSCALE_IMAGE_BYTES = 25 * MB;
export const MAX_TRANSCRIPTION_AUDIO_BYTES = 200 * MB;
export const MAX_VIDEO_REFERENCE_IMAGE_BYTES = 20 * MB;
export const MAX_VIDEO_UPSCALE_BYTES = 200 * MB;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 120000;
const DEFAULT_STREAM_INACTIVITY_TIMEOUT_MS = 120000;

export async function readWithInactivityTimeout<T>(
  reader: ReadableStreamDefaultReader<T>,
  timeoutMs: number
): Promise<ReadableStreamReadResult<T>> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Download stalled for ${Math.ceil(timeoutMs / 1000)} seconds.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

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

export function writeBufferToFile(
  bytes: Buffer,
  outputPath: string,
  options: { maxBytes: number; label: string }
): { bytesWritten: number } {
  if (bytes.length > options.maxBytes) {
    throw new Error(
      `${options.label} is too large (${formatBytes(bytes.length)}). ` +
      `Maximum allowed size is ${formatBytes(options.maxBytes)}.`
    );
  }

  if (bytes.length === 0) {
    throw new Error(`${options.label} response was empty.`);
  }

  const outputDir = path.dirname(outputPath);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, bytes);
  return { bytesWritten: bytes.length };
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
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.opus': 'audio/opus',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
    '.m4a': 'audio/mp4',
  };

  return mimeByExtension[ext] || fallback;
}

export async function fileToDataUrl(
  filePath: string,
  maxBytes: number,
  label: string
): Promise<string> {
  assertFileSizeWithinLimit(filePath, maxBytes, label);
  const data = await fs.promises.readFile(filePath);
  const mimeType = mimeTypeFromPath(filePath, 'video/mp4');
  return `data:${mimeType};base64,${data.toString('base64')}`;
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

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    return await writeResponseToFile(response, outputPath, options);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Download timed out after ${Math.ceil(timeoutMs / 1000)} seconds.`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function writeResponseToFile(
  response: Response,
  outputPath: string,
  options: {
    maxBytes: number;
    expectedContentTypePrefixes: string[];
  }
): Promise<{ bytesWritten: number; contentType: string }> {
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
  if (contentLength === 0) {
    throw new Error('Download response was empty.');
  }
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
  const tempPath = path.join(
    outputDir,
    `.${path.basename(outputPath)}.${Date.now()}.${Math.random().toString(16).slice(2)}.part`
  );

  try {
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

    if (bytesWritten === 0) {
      throw new Error('Download response was empty.');
    }
    fs.renameSync(tempPath, outputPath);
    return { bytesWritten, contentType };
  } catch (error) {
    if (fs.existsSync(tempPath)) {
      fs.rmSync(tempPath, { force: true });
    }
    throw error;
  }
}

export async function streamResponseToFile(
  response: Response,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  initialChunks: Buffer[],
  outputPath: string,
  options: {
    maxBytes: number;
    label: string;
    inactivityTimeoutMs?: number;
  }
): Promise<{ bytesWritten: number; contentType: string }> {
  let tempPath: string | null = null;
  let bytesWritten = 0;
  const inactivityTimeoutMs =
    options.inactivityTimeoutMs ?? DEFAULT_STREAM_INACTIVITY_TIMEOUT_MS;

  try {
    const contentLength = parseContentLength(response.headers.get('content-length'));
    if (contentLength !== null && contentLength > options.maxBytes) {
      throw new Error(
        `Refusing to download ${formatBytes(contentLength)}. ` +
        `Maximum allowed size is ${formatBytes(options.maxBytes)}.`
      );
    }

    const outputDir = path.dirname(outputPath);
    fs.mkdirSync(outputDir, { recursive: true });
    tempPath = path.join(
      outputDir,
      `.${path.basename(outputPath)}.${Date.now()}.${Math.random().toString(16).slice(2)}.part`
    );

    const source = Readable.from((async function* () {
      for (const chunk of initialChunks) {
        yield chunk;
      }
      while (true) {
        const { done, value } = await readWithInactivityTimeout(
          reader,
          inactivityTimeoutMs
        );
        if (done) return;
        yield Buffer.from(value);
      }
    })());
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytesWritten += chunk.length;
        if (bytesWritten > options.maxBytes) {
          callback(
            new Error(
              `${options.label} download exceeded limit of ${formatBytes(options.maxBytes)}. ` +
              'The response may be unexpectedly large.'
            )
          );
          return;
        }
        callback(null, chunk);
      },
    });

    await pipeline(source, limiter, fs.createWriteStream(tempPath));
    if (bytesWritten === 0) {
      throw new Error(`${options.label} response was empty.`);
    }
    fs.renameSync(tempPath, outputPath);
    tempPath = null;
    return {
      bytesWritten,
      contentType: response.headers.get('content-type') || 'video/mp4',
    };
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (tempPath && fs.existsSync(tempPath)) {
      fs.rmSync(tempPath, { force: true });
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}
