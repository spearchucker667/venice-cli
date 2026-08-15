/**
 * Venice AI API Client
 * 
 * Handles all API communication with retry logic and error handling.
 */

import { requireApiKey, trackUsage } from './config.js';
import { startSpinner, stopSpinner } from './output.js';
import { getVersion } from './version.js';
import { Readable } from 'stream';
import type { Message, ToolDefinition, Model, Character } from '../types/index.js';
import {
  MAX_IMAGE_DOWNLOAD_BYTES,
  MAX_UPSCALE_IMAGE_BYTES,
  MAX_TRANSCRIPTION_AUDIO_BYTES,
  MAX_VIDEO_DOWNLOAD_BYTES,
  assertFileSizeWithinLimit,
  formatBytes,
  mimeTypeFromPath,
  streamResponseToFile,
} from './media.js';

// TODO: Remove VENICE_API_BASE_URL override before release - only for local dev testing
const VENICE_API = process.env.VENICE_API_BASE_URL || 'https://api.venice.ai/api/v1';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const DEFAULT_TIMEOUT_MS = 120000; // 2 minutes default timeout
const MAX_VIDEO_STATUS_BYTES = 1024 * 1024;

export class VeniceApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public code?: string
  ) {
    super(message);
    this.name = 'VeniceApiError';
  }

  static fromResponse(status: number, body: string): VeniceApiError {
    try {
      const json = JSON.parse(body);
      const message = json.error?.message || json.message || body;
      const code = json.error?.code;
      return new VeniceApiError(message, status, code);
    } catch {
      return new VeniceApiError(body || `HTTP ${status}`, status);
    }
  }

  isRetryable(): boolean {
    // Retry on network errors and 5xx
    if (!this.statusCode) return true;
    return this.statusCode >= 500 && this.statusCode < 600;
  }

  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }

  isRateLimited(): boolean {
    return this.statusCode === 429;
  }
}

function getHeaders(): Record<string, string> {
  return {
    'Authorization': `Bearer ${requireApiKey()}`,
    'Content-Type': 'application/json',
    'User-Agent': `venice-cli/${getVersion()}`,
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkOnline(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    await fetch('https://api.venice.ai/api/v1/models', {
      method: 'HEAD',
      signal: controller.signal,
    });
    
    clearTimeout(timeout);
    return true;
  } catch {
    return false;
  }
}

export async function apiRequest<T>(
  endpoint: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: unknown;
    stream?: boolean;
    retries?: number;
    showSpinner?: boolean;
    spinnerText?: string;
    timeoutMs?: number;
    additionalHeaders?: Record<string, string>;
  } = {}
): Promise<T> {
  const {
    method = 'GET',
    body,
    stream = false,
    retries = MAX_RETRIES,
    showSpinner = true,
    spinnerText = 'Processing...',
    timeoutMs = DEFAULT_TIMEOUT_MS,
    additionalHeaders = {},
  } = options;

  let spinner = showSpinner && !stream ? startSpinner(spinnerText) : null;
  let lastError: VeniceApiError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${VENICE_API}${endpoint}`, {
        method,
        headers: { ...getHeaders(), ...additionalHeaders },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = await response.text();
        throw VeniceApiError.fromResponse(response.status, errorBody);
      }

      if (spinner) {
        stopSpinner(true);
        spinner = null;
      }

      if (stream) {
        return response as unknown as T;
      }

      return await response.json() as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        if (spinner) stopSpinner(false, 'Request timed out');
        throw new Error(
          `Request timed out after ${timeoutMs / 1000} seconds.\n` +
          'The server may be overloaded. Please try again later.'
        );
      }

      if (error instanceof VeniceApiError) {
        lastError = error;

        if (error.isAuthError()) {
          if (spinner) stopSpinner(false, 'Authentication failed');
          throw new Error(
            'Authentication failed. Please check your API key.\n' +
            'Update with: venice config set api_key'
          );
        }

        if (error.isRateLimited()) {
          if (spinner) spinner.text = `Rate limited, waiting... (attempt ${attempt + 1}/${retries + 1})`;
          await sleep(RETRY_DELAY_MS * (attempt + 1) * 2);
          continue;
        }

        if (error.isRetryable() && attempt < retries) {
          if (spinner) spinner.text = `Retrying... (attempt ${attempt + 2}/${retries + 1})`;
          await sleep(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
      } else if (error instanceof Error) {
        if (attempt < retries) {
          const online = await checkOnline();
          if (!online) {
            if (spinner) stopSpinner(false, 'Network error');
            throw new Error(
              'Unable to connect to Venice API.\n' +
              'Please check your internet connection.'
            );
          }
          if (spinner) spinner.text = `Connection error, retrying... (attempt ${attempt + 2}/${retries + 1})`;
          await sleep(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
        lastError = new VeniceApiError(error.message);
      }

      if (spinner) stopSpinner(false);
      throw lastError || error;
    }
  }

  if (spinner) stopSpinner(false);
  throw lastError || new Error('Request failed after retries');
}

// Chat completion (non-streaming)
export async function chatCompletion(
  messages: Message[],
  options: {
    model?: string;
    tools?: ToolDefinition[];
    tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
    venice_parameters?: Record<string, unknown>;
  } = {}
): Promise<{
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  finish_reason: string;
}> {
  const body: Record<string, unknown> = {
    model: options.model || 'kimi-k2-5',
    messages,
    stream: false,
  };

  if (options.tools?.length) {
    body.tools = options.tools;
    body.tool_choice = options.tool_choice || 'auto';
  }

  if (options.venice_parameters) {
    body.venice_parameters = options.venice_parameters;
  }

  const response = await apiRequest<{
    choices: Array<{
      message: { content: string; tool_calls?: any[] };
      finish_reason: string;
    }>;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  }>('/chat/completions', {
    method: 'POST',
    body,
    spinnerText: 'Thinking...',
  });

  const choice = response.choices?.[0];
  const usage = response.usage;

  // Track usage
  if (usage) {
    trackUsage({
      command: 'chat',
      model: options.model || 'kimi-k2-5',
      ...usage,
    });
  }

  return {
    content: choice?.message?.content || '',
    tool_calls: choice?.message?.tool_calls,
    usage,
    finish_reason: choice?.finish_reason || 'stop',
  };
}

// Chat completion (streaming)
export async function* chatCompletionStream(
  messages: Message[],
  options: {
    model?: string;
    tools?: ToolDefinition[];
    tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
    venice_parameters?: Record<string, unknown>;
    additionalHeaders?: Record<string, string>;
  } = {}
): AsyncGenerator<{
  content?: string;
  tool_calls?: any[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  completionId?: string;
  done: boolean;
}> {
  const body: Record<string, unknown> = {
    model: options.model || 'kimi-k2-5',
    messages,
    stream: true,
    stream_options: { include_usage: true },
  };

  if (options.tools?.length) {
    body.tools = options.tools;
    body.tool_choice = options.tool_choice || 'auto';
  }

  if (options.venice_parameters) {
    body.venice_parameters = options.venice_parameters;
  }

  const response = await apiRequest<Response>('/chat/completions', {
    method: 'POST',
    body,
    stream: true,
    showSpinner: false,
    additionalHeaders: options.additionalHeaders,
  });

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';
  let totalUsage: any = null;
  let completionId: string | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            if (totalUsage) {
              trackUsage({
                command: 'chat',
                model: options.model || 'kimi-k2-5',
                ...totalUsage,
              });
            }
            yield { done: true, usage: totalUsage, completionId };
            return;
          }

          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta;
            
            // Capture completion ID for E2EE signature verification
            if (json.id && !completionId) {
              completionId = json.id;
            }

            if (json.usage) {
              totalUsage = json.usage;
            }

            if (delta?.content) {
              yield { content: delta.content, done: false, completionId };
            }

            if (delta?.tool_calls) {
              yield { tool_calls: delta.tool_calls, done: false, completionId };
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  yield { done: true, usage: totalUsage, completionId };
}

// Image generation (Venice-native endpoint)
export async function generateImage(
  prompt: string,
  options: {
    model?: string;
    width?: number;
    height?: number;
    n?: number;
    format?: 'png' | 'jpeg' | 'webp';
  } = {}
): Promise<string[]> {
  const body: Record<string, unknown> = {
    model: options.model || 'flux-2-pro',
    prompt,
    width: options.width || 1024,
    height: options.height || 1024,
    format: options.format || 'png',
  };

  if (options.n && options.n > 1) {
    body.variants = options.n;
  }

  const response = await apiRequest<{
    id: string;
    images: string[];
  }>('/image/generate', {
    method: 'POST',
    body,
    spinnerText: 'Generating image...',
  });

  trackUsage({
    command: 'image',
    model: options.model || 'flux-2-pro',
  });

  return response.images;
}

export type UpscaleImageResult = {
  bytes: Buffer;
  contentType: string;
};

export function isImageContentType(contentType: string | null | undefined): boolean {
  const type = (contentType || '').split(';')[0].trim().toLowerCase();
  return type.startsWith('image/');
}

export function looksLikeImageBytes(bytes: Buffer): boolean {
  if (bytes.length < 12) return false;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
    return true;
  }
  return false;
}

async function readResponseBodyWithLimit(
  response: Response,
  maxBytes: number,
  label: string
): Promise<Buffer> {
  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength >= 0 && contentLength > maxBytes) {
      await response.body?.cancel();
      throw new Error(
        `${label} is too large (${formatBytes(contentLength)}). ` +
        `Maximum allowed size is ${formatBytes(maxBytes)}.`
      );
    }
  }

  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new Error(
          `${label} exceeded the limit of ${formatBytes(maxBytes)}.`
        );
      }

      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, totalBytes);
}

// Image upscale
export async function upscaleImage(
  imagePath: string,
  options: {
    model?: string;
    scale?: number;
  } = {}
): Promise<UpscaleImageResult> {
  const fs = await import('fs');

  if (!fs.existsSync(imagePath)) {
    throw new Error(`File not found: ${imagePath}`);
  }

  assertFileSizeWithinLimit(imagePath, MAX_UPSCALE_IMAGE_BYTES, 'Image file for upscaling');

  const imageData = await fs.promises.readFile(imagePath);
  const body = {
    image: imageData.toString('base64'),
    scale: options.scale || 2,
    ...(options.model ? { model: options.model } : {}),
  };

  const spinner = startSpinner('Upscaling image...');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${VENICE_API}/image/upscale`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const bytes = await readResponseBodyWithLimit(
      response,
      MAX_IMAGE_DOWNLOAD_BYTES,
      response.ok ? 'Upscaled image response' : 'Upscale API error response'
    );

    if (!response.ok) {
      const errorBody = bytes.toString('utf-8');
      throw VeniceApiError.fromResponse(response.status, errorBody);
    }

    const contentType = response.headers.get('content-type') || '';

    if (!isImageContentType(contentType) && !looksLikeImageBytes(bytes)) {
      const preview = bytes.subarray(0, 200).toString('utf-8');
      throw new Error(
        `Upscale did not return an image (content-type: ${contentType || 'unknown'}). ` +
        `Response preview: ${preview}`
      );
    }

    if (spinner) stopSpinner(true);

    trackUsage({
      command: 'upscale',
      model: options.model || 'upscaler',
    });

    return {
      bytes,
      contentType: contentType.split(';')[0].trim() || 'image/png',
    };
  } catch (error) {
    if (spinner) stopSpinner(false);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Image upscale request timed out. Please try again later.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Text to speech
export async function textToSpeech(
  text: string,
  options: {
    model?: string;
    voice?: string;
    format?: 'mp3' | 'wav' | 'opus';
  } = {}
): Promise<ArrayBuffer> {
  const body = {
    model: options.model || 'tts-kokoro',
    input: text,
    voice: options.voice || 'af_sky',
    response_format: options.format || 'mp3',
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${VENICE_API}/audio/speech`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const error = await response.text();
      throw VeniceApiError.fromResponse(response.status, error);
    }

    trackUsage({
      command: 'tts',
      model: options.model || 'tts-kokoro',
    });

    return response.arrayBuffer();
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Text-to-speech request timed out. Please try with shorter text.');
    }
    throw error;
  }
}

// Transcription (STT) -- requires multipart/form-data upload
export async function transcribe(
  audioPath: string,
  options: {
    model?: string;
    language?: string;
    timestamps?: boolean;
  } = {}
): Promise<{
  text: string;
  duration?: number;
  timestamps?: {
    word?: Array<{ word: string; start: number; end: number }>;
    segment?: Array<{ text: string; start: number; end: number }>;
  };
}> {
  const fs = await import('fs');
  const path = await import('path');
  const crypto = await import('crypto');

  if (!fs.existsSync(audioPath)) {
    throw new Error(`File not found: ${audioPath}`);
  }

  const fileSize = assertFileSizeWithinLimit(
    audioPath,
    MAX_TRANSCRIPTION_AUDIO_BYTES,
    'Audio file for transcription'
  );
  const filename = path.basename(audioPath);
  const mimeType = mimeTypeFromPath(audioPath, 'application/octet-stream');

  const boundary = `----venice-cli-${crypto.randomUUID()}`;
  const CRLF = '\r\n';
  const escapeField = (value: string): string => value.replace(/"/g, '\\"');

  const formFields: Array<[string, string]> = [
    ['model', options.model || 'nvidia/parakeet-tdt-0.6b-v3'],
    ['response_format', 'json'],
  ];
  if (options.language) {
    formFields.push(['language', options.language]);
  }
  if (options.timestamps) {
    formFields.push(['timestamp_granularities[]', 'word']);
    formFields.push(['timestamp_granularities[]', 'segment']);
  }

  const fieldsPrefix = formFields
    .map(([name, value]) =>
      `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${escapeField(name)}"${CRLF}${CRLF}` +
      `${value}${CRLF}`
    )
    .join('');
  const fileHeader =
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="file"; filename="${escapeField(filename)}"${CRLF}` +
    `Content-Type: ${mimeType}${CRLF}${CRLF}`;
  const closingBoundary = `${CRLF}--${boundary}--${CRLF}`;

  const headerBuffer = Buffer.from(fieldsPrefix + fileHeader, 'utf-8');
  const footerBuffer = Buffer.from(closingBoundary, 'utf-8');
  const contentLength = headerBuffer.length + fileSize + footerBuffer.length;

  const multipartBody = Readable.from((async function* () {
    yield headerBuffer;
    for await (const chunk of fs.createReadStream(audioPath)) {
      yield chunk;
    }
    yield footerBuffer;
  })());

  const spinner = startSpinner('Transcribing...');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const requestInit: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${requireApiKey()}`,
        'User-Agent': `venice-cli/${getVersion()}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(contentLength),
      },
      body: multipartBody as unknown as RequestInit['body'],
      duplex: 'half',
      signal: controller.signal,
    };

    const res = await fetch(`${VENICE_API}/audio/transcriptions`, {
      ...requestInit,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errorBody = await res.text();
      throw VeniceApiError.fromResponse(res.status, errorBody);
    }

    if (spinner) stopSpinner(true);

    const response = await res.json() as {
      text: string;
      duration?: number;
      timestamps?: {
        word?: Array<{ word: string; start: number; end: number }>;
        segment?: Array<{ text: string; start: number; end: number }>;
      };
    };

    trackUsage({
      command: 'transcribe',
      model: options.model || 'nvidia/parakeet-tdt-0.6b-v3',
    });

    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (spinner) stopSpinner(false);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Transcription request timed out. Try a shorter audio file.');
    }
    throw error;
  }
}

// Embeddings
export async function generateEmbeddings(
  input: string | string[],
  options: {
    model?: string;
  } = {}
): Promise<{ embedding: number[]; index: number }[]> {
  const body = {
    model: options.model || 'text-embedding-ada-002',
    input: Array.isArray(input) ? input : [input],
  };

  const response = await apiRequest<{
    data: Array<{ embedding: number[]; index: number }>;
  }>('/embeddings', {
    method: 'POST',
    body,
    spinnerText: 'Generating embeddings...',
  });

  trackUsage({
    command: 'embeddings',
    model: options.model || 'text-embedding-ada-002',
  });

  return response.data;
}

// List models
export async function listModels(
  options: { showSpinner?: boolean } = {}
): Promise<Model[]> {
  const { showSpinner: showSpinnerOption = true } = options;
  const modelTypes = ['text', 'asr', 'embedding', 'image', 'tts', 'upscale', 'inpaint', 'video', 'music'];
  const merged = new Map<string, Model>();

  // API defaults to text-only when no type is provided, so iterate known types
  const requests: Array<{ endpoint: string; requestedType?: string; showSpinner: boolean }> = [
    { endpoint: '/models', showSpinner: showSpinnerOption },
    ...modelTypes.map((type) => ({
      endpoint: `/models?type=${encodeURIComponent(type)}`,
      requestedType: type,
      showSpinner: false,
    })),
  ];

  for (const request of requests) {
    try {
      const response = await apiRequest<{ data: Model[] }>(request.endpoint, {
        method: 'GET',
        spinnerText: 'Fetching models...',
        showSpinner: request.showSpinner,
      });

      for (const model of response.data || []) {
        const normalized: Model = { ...model };

        // Some API responses still label type as text; preserve requested typed endpoint info
        if (
          request.requestedType &&
          (!normalized.type || normalized.type.toLowerCase() === 'text')
        ) {
          normalized.type = request.requestedType;
        }

        const key = normalized.id || JSON.stringify(normalized);
        const existing = merged.get(key);

        if (!existing) {
          merged.set(key, normalized);
          continue;
        }

        // Prefer non-text type metadata when deduplicating
        const existingType = (existing.type || '').toLowerCase();
        const normalizedType = (normalized.type || '').toLowerCase();
        if (existingType === 'text' && normalizedType && normalizedType !== 'text') {
          merged.set(key, normalized);
        }
      }
    } catch (error) {
      // Keep typed fallback resilient. If the base endpoint fails, surface the error.
      if (!request.requestedType) {
        throw error;
      }
    }
  }

  return Array.from(merged.values());
}

// List characters (if Venice supports this endpoint)
export async function listCharacters(): Promise<Character[]> {
  try {
    const response = await apiRequest<{
      data: Character[];
    }>('/characters', {
      method: 'GET',
      spinnerText: 'Fetching characters...',
      retries: 0,
    });
    return response.data || [];
  } catch {
    // Characters endpoint might not exist
    return [];
  }
}

export type VideoStatusResult = {
  status: string;
  average_execution_time?: number;
  execution_duration?: number;
  video_url?: string;
  download_url?: string;
  error?: string;
  model?: string;
  duration?: number;
};

export type VideoRetrieveResult =
  | { kind: 'status'; status: VideoStatusResult }
  | { kind: 'video'; bytesWritten: number; contentType: string };

export function classifyVideoRetrieveContentType(
  contentType: string | null | undefined
): 'json' | 'video' | 'unknown' {
  const type = (contentType || '').split(';')[0].trim().toLowerCase();
  if (!type) return 'unknown';
  if (type === 'application/json' || type.endsWith('+json')) return 'json';
  if (type.startsWith('video/') || type === 'application/octet-stream') return 'video';
  return 'unknown';
}

async function retrieveVideoResponse(
  queueId: string,
  model: string,
  options: {
    deleteOnCompletion?: boolean;
    spinnerText?: string;
    statusOnly?: boolean;
    outputPath?: string;
    maxBytes?: number;
  } = {}
): Promise<VideoRetrieveResult> {
  const spinner = startSpinner(options.spinnerText || 'Checking video status...');
  const body: Record<string, unknown> = { queue_id: queueId, model };
  if (options.deleteOnCompletion !== undefined) {
    body.delete_media_on_completion = options.deleteOnCompletion;
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    let fileWriteStarted = false;
    let requestTimeoutActive = true;
    const clearRequestTimeout = () => {
      if (requestTimeoutActive) {
        clearTimeout(timeoutId);
        requestTimeoutActive = false;
      }
    };

    try {
      const response = await fetch(`${VENICE_API}/video/retrieve`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw VeniceApiError.fromResponse(response.status, errorBody);
      }

      const inspected = await inspectVideoRetrieveResponse(response);
      if (inspected.kind === 'status') {
        if (spinner) stopSpinner(true);
        return inspected;
      }

      // The request deadline bounds headers and body inspection only. Once an
      // MP4 is confirmed, chunk-level inactivity timeouts protect the download.
      clearRequestTimeout();

      if (options.statusOnly) {
        await inspected.reader.cancel();
        inspected.reader.releaseLock();
        if (spinner) stopSpinner(true);
        return { kind: 'status', status: { status: 'completed' } };
      }

      if (!options.outputPath) {
        await inspected.reader.cancel();
        inspected.reader.releaseLock();
        throw new VideoRetrieveValidationError(
          'An output path is required to save the retrieved video.'
        );
      }

      fileWriteStarted = true;
      const saved = await streamResponseToFile(
        response,
        inspected.reader,
        inspected.initialChunks,
        options.outputPath,
        {
          maxBytes: options.maxBytes ?? MAX_VIDEO_DOWNLOAD_BYTES,
          label: 'Video',
        }
      );
      if (spinner) stopSpinner(true);
      return { kind: 'video', ...saved };
    } catch (error) {
      const retryable =
        !fileWriteStarted &&
        attempt < MAX_RETRIES &&
        !(error instanceof VideoRetrieveValidationError) &&
        (
          !(error instanceof VeniceApiError) ||
          error.isRetryable() ||
          error.isRateLimited()
        );

      if (retryable) {
        await sleep(RETRY_DELAY_MS * (attempt + 1) * (
          error instanceof VeniceApiError && error.isRateLimited() ? 2 : 1
        ));
        continue;
      }

      if (spinner) stopSpinner(false);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Video retrieve request timed out. Please try again later.');
      }
      throw error;
    } finally {
      clearRequestTimeout();
    }
  }

  if (spinner) stopSpinner(false);
  throw new Error('Video retrieve request failed after retries.');
}

type InspectedVideoResponse =
  | { kind: 'status'; status: VideoStatusResult }
  | {
      kind: 'video';
      reader: ReadableStreamDefaultReader<Uint8Array>;
      initialChunks: Buffer[];
    };

class VideoRetrieveValidationError extends Error {}

async function inspectVideoRetrieveResponse(
  response: Response
): Promise<InspectedVideoResponse> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new VideoRetrieveValidationError('Video retrieve response had no body.');
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let readingJson = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = Buffer.from(value);
      chunks.push(chunk);
      totalBytes += chunk.length;
      const buffered = Buffer.concat(chunks, totalBytes);

      if (!readingJson && buffered.length >= 8) {
        if (isMp4Buffer(buffered)) {
          return { kind: 'video', reader, initialChunks: chunks };
        }

        const firstNonWhitespace = buffered.find((byte) => byte > 0x20);
        if (firstNonWhitespace === 0x7b) {
          readingJson = true;
        } else if (firstNonWhitespace !== undefined) {
          throw unexpectedVideoRetrieveType(response);
        }
      }

      if (totalBytes > MAX_VIDEO_STATUS_BYTES) {
        throw new VideoRetrieveValidationError(
          'Video status response exceeded the maximum expected size.'
        );
      }
    }

    const buffered = Buffer.concat(chunks, totalBytes);
    const firstNonWhitespace = buffered.find((byte) => byte > 0x20);
    if (readingJson || firstNonWhitespace === 0x7b) {
      const status = JSON.parse(buffered.toString('utf-8')) as VideoStatusResult;
      reader.releaseLock();
      return { kind: 'status', status };
    }
    if (isMp4Buffer(buffered)) {
      return { kind: 'video', reader, initialChunks: chunks };
    }
    throw unexpectedVideoRetrieveType(response);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    throw error;
  }
}

function unexpectedVideoRetrieveType(response: Response): Error {
  return new VideoRetrieveValidationError(
    `Unexpected video retrieve content type "${response.headers.get('content-type') || 'unknown'}": ` +
    'response is neither JSON nor a valid MP4.'
  );
}

function isMp4Buffer(bytes: Buffer): boolean {
  return bytes.length >= 8 && bytes.subarray(4, 8).toString('ascii') === 'ftyp';
}

// Video generation - queue job
export async function queueVideoGeneration(
  prompt: string,
  options: {
    model?: string;
    duration?: string;
    aspectRatio?: string;
    imageUrl?: string;
  } = {}
): Promise<{ queue_id: string; model: string }> {
  const body: Record<string, unknown> = {
    model: options.model || 'wan-2.6-text-to-video',
    prompt,
    duration: options.duration || '5s',
  };
  if (options.aspectRatio) {
    body.aspect_ratio = options.aspectRatio;
  }
  if (options.imageUrl) {
    body.image_url = options.imageUrl;
  }

  const response = await apiRequest<{
    queue_id: string;
    model: string;
  }>('/video/queue', {
    method: 'POST',
    body,
    spinnerText: 'Queueing video generation...',
  });

  trackUsage({
    command: 'video',
    model: options.model || 'wan-2.6-text-to-video',
  });

  return response;
}

// Video generation - check status / retrieve result
export async function getVideoStatus(
  queueId: string,
  model: string
): Promise<VideoStatusResult> {
  const result = await retrieveVideoResponse(queueId, model, {
    spinnerText: 'Checking video status...',
    statusOnly: true,
  });

  if (result.kind === 'video') {
    return { status: 'completed' };
  }

  return result.status;
}

// Video generation - retrieve video
export async function retrieveVideo(
  queueId: string,
  model: string,
  options: {
    deleteOnCompletion?: boolean;
    outputPath?: string;
    maxBytes?: number;
  } = {}
): Promise<VideoRetrieveResult> {
  return retrieveVideoResponse(queueId, model, {
    deleteOnCompletion: options.deleteOnCompletion ?? false,
    spinnerText: 'Retrieving video...',
    outputPath: options.outputPath,
    maxBytes: options.maxBytes,
  });
}

export interface AudioGenerationOptions {
  model: string;
  durationSeconds?: number;
  lyricsPrompt?: string;
  forceInstrumental?: boolean;
}

export interface AudioProcessingStatus {
  status: string;
  average_execution_time?: number;
  execution_duration?: number;
  error?: string;
}

export type AudioRetrieveResult =
  | { kind: 'processing'; status: AudioProcessingStatus }
  | { kind: 'audio'; response: Response; contentType: string; sizeBytes?: number };

function audioGenerationBody(
  prompt: string,
  options: AudioGenerationOptions
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.model,
    prompt,
  };

  if (options.durationSeconds !== undefined) {
    body.duration_seconds = options.durationSeconds;
  }
  if (options.lyricsPrompt !== undefined) {
    body.lyrics_prompt = options.lyricsPrompt;
  }
  if (options.forceInstrumental !== undefined) {
    body.force_instrumental = options.forceInstrumental;
  }

  return body;
}

// Music and sound effects - get a price quote
export async function quoteAudioGeneration(
  model: string,
  options: { durationSeconds?: number; characterCount?: number } = {}
): Promise<{ quote: number }> {
  const body: Record<string, unknown> = { model };
  if (options.durationSeconds !== undefined) {
    body.duration_seconds = options.durationSeconds;
  }
  if (options.characterCount !== undefined) {
    body.character_count = options.characterCount;
  }

  return apiRequest('/audio/quote', {
    method: 'POST',
    body,
    spinnerText: 'Fetching audio quote...',
  });
}

// Music and sound effects - queue a generation job
export async function queueAudioGeneration(
  prompt: string,
  options: AudioGenerationOptions
): Promise<{ model: string; queue_id: string; status: string }> {
  const response = await apiRequest<{
    model: string;
    queue_id: string;
    status: string;
  }>('/audio/queue', {
    method: 'POST',
    body: audioGenerationBody(prompt, options),
    spinnerText: 'Queueing audio generation...',
  });

  trackUsage({ command: 'music', model: options.model });
  return response;
}

// Music and sound effects - retrieve processing status or completed binary audio
export async function retrieveGeneratedAudio(
  queueId: string,
  model: string
): Promise<AudioRetrieveResult> {
  const response = await apiRequest<Response>('/audio/retrieve', {
    method: 'POST',
    body: { queue_id: queueId, model, delete_media_on_completion: false },
    stream: true,
    showSpinner: false,
  });
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || '';

  if (contentType === 'application/json') {
    return {
      kind: 'processing',
      status: await response.json() as AudioProcessingStatus,
    };
  }

  if (!['audio/mpeg', 'audio/wav', 'audio/flac'].includes(contentType)) {
    throw new Error(
      `Unexpected audio response content type "${contentType || 'missing'}".`
    );
  }

  return {
    kind: 'audio',
    response,
    contentType,
    sizeBytes: (() => {
      const value = response.headers.get('content-length');
      if (!value) return undefined;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
    })(),
  };
}

// Music and sound effects - clean up stored media after a successful download
export async function completeAudioGeneration(
  queueId: string,
  model: string
): Promise<{ success: boolean }> {
  return apiRequest('/audio/complete', {
    method: 'POST',
    body: { queue_id: queueId, model },
    spinnerText: 'Cleaning up generated audio...',
  });
}

// Web search via chat
export async function webSearch(
  query: string,
  options: {
    model?: string;
    maxResults?: number;
    enableCitations?: boolean;
    enableScraping?: boolean;
  } = {}
): Promise<{
  content: string;
  citations?: Array<{ title: string; url: string }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}> {
  const veniceParams: Record<string, unknown> = {
    enable_web_search: 'on',
  };

  if (options.maxResults) {
    veniceParams.web_search_max_results = options.maxResults;
  }
  if (options.enableCitations) {
    veniceParams.enable_web_citations = true;
  }
  if (options.enableScraping) {
    veniceParams.enable_web_scraping = true;
  }

  const response = await chatCompletion(
    [{ role: 'user', content: query }],
    {
      model: options.model,
      venice_parameters: veniceParams,
    }
  );

  return {
    content: response.content,
    usage: response.usage,
  };
}

// TEE Attestation types
export type TeeAttestationResponse = {
  verified?: boolean;
  nonce: string;
  model: string;
  intel_quote?: string;
  signing_address?: string;
  signing_key?: string;
  signing_public_key?: string;
  nvidia_payload?: string;
  server_verification?: {
    tdx?: { valid: boolean; error?: string };
    nvidia?: { valid: boolean; error?: string };
    signingAddressBinding?: { bound: boolean; error?: string };
    nonceBinding?: { bound: boolean; method?: 'sha256' | 'raw'; error?: string };
    verifiedAt: string;
    verificationDurationMs: number;
  };
  tee_provider?: string;
};

export type TeeSignatureResponse = {
  text?: string;
  signature?: string | { algorithm?: string; value?: string; public_key?: string };
  signing_address?: string;
  payload?: { request_hash?: string; response_hash?: string; timestamp?: string };
  model?: string;
  request_id?: string;
  requested_request_id?: string;
  tee_provider?: string;
  tee_hardware?: string;
};

function generateClientNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Fetch TEE attestation for a model
export async function fetchTeeAttestation(
  modelId: string,
  options: { showSpinner?: boolean } = {}
): Promise<{
  response: TeeAttestationResponse;
  clientNonce: string;
}> {
  const { showSpinner = true } = options;
  const clientNonce = generateClientNonce();
  const endpoint = `/tee/attestation?model=${encodeURIComponent(modelId)}&nonce=${clientNonce}`;

  const response = await apiRequest<TeeAttestationResponse>(endpoint, {
    method: 'GET',
    showSpinner,
    spinnerText: 'Fetching TEE attestation...',
    retries: 5,
  });

  return { response, clientNonce };
}

// Fetch TEE signature for a completed request
export async function fetchTeeSignature(
  modelId: string,
  completionId: string
): Promise<TeeSignatureResponse> {
  const endpoint = `/tee/signature?request_id=${encodeURIComponent(completionId)}&model=${encodeURIComponent(modelId)}`;

  return apiRequest<TeeSignatureResponse>(endpoint, {
    method: 'GET',
    spinnerText: 'Fetching TEE signature...',
    retries: 1,
  });
}
