/**
 * Venice AI API Client
 * 
 * Handles all API communication with retry logic and error handling.
 */

import {
  trackUsage,
  DEFAULT_MODELS,
  getConfigValue,
} from './config.js';
import { startSpinner, stopSpinner } from './output.js';
import { Readable } from 'stream';
import {
  apiRequest,
  DEFAULT_TIMEOUT_MS,
  getHeaders,
  MAX_RETRIES,
  parseUsageHeaders,
  readResponseBodyWithLimit,
  readSseFrames,
  RETRY_DELAY_MS,
  sleep,
  VENICE_API,
  VeniceApiError,
  isImageContentType,
  looksLikeImageBytes,
} from './transport.js';
import type { UsageHeaders } from './transport.js';

// Re-export the transport surface so existing callers keep importing from api.js.
export {
  apiRequest,
  getHeaders,
  parseUsageHeaders,
  VeniceApiError,
  isImageContentType,
  looksLikeImageBytes,
} from './transport.js';
export type { UsageHeaders, VeniceErrorContract } from './transport.js';
import type {
  Message,
  ToolDefinition,
  Model,
  Character,
  CharacterReviewsPage,
  ImageGenerationOptions,
} from '../types/index.js';
import type {
  PromptCacheRetention,
  ReasoningEffort,
  ResponseFormat,
} from './structured-output.js';
import {
  MAX_AUDIO_DOWNLOAD_BYTES,
  MAX_IMAGE_EDIT_BYTES,
  MAX_IMAGE_DOWNLOAD_BYTES,
  MAX_UPSCALE_IMAGE_BYTES,
  MAX_TRANSCRIPTION_AUDIO_BYTES,
  MAX_DOCUMENT_PARSE_BYTES,
  MAX_VOICE_SAMPLE_BYTES,
  MAX_VIDEO_DOWNLOAD_BYTES,
  assertFileSizeWithinLimit,
  mimeTypeFromPath,
  streamResponseToFile,
} from './media.js';

// Endpoint-specific limits; shared transport constants live in transport.ts.
const DOCUMENT_PARSE_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_DOCUMENT_PARSE_RESPONSE_BYTES = 50 * 1024 * 1024;
const MAX_VIDEO_STATUS_BYTES = 1024 * 1024;

/** Reasoning configuration for supported models (Venice `reasoning` field). */
export interface ReasoningConfig {
  effort?: ReasoningEffort;
  summary?: 'auto' | 'concise' | 'detailed';
}

/** OpenAI-compatible text configuration (Venice `text` field). */
export interface TextConfig {
  verbosity?: 'low' | 'medium' | 'high' | 'auto';
}

export interface ChatCompletionRequestOptions {
  model?: string;
  tools?: ToolDefinition[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  venice_parameters?: Record<string, unknown>;
  additionalHeaders?: Record<string, string>;
  response_format?: ResponseFormat;
  reasoning_effort?: ReasoningEffort;
  /** Structured reasoning config (`reasoning.effort` / `reasoning.summary`). */
  reasoning?: ReasoningConfig;
  prompt_cache_key?: string;
  prompt_cache_retention?: PromptCacheRetention;
  showSpinner?: boolean;
  parallel_tool_calls?: boolean;
  max_completion_tokens?: number;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  min_p?: number;
  /** Dynamic temperature floor (Venice `min_temp`). */
  min_temp?: number;
  /** Dynamic temperature ceiling (Venice `max_temp`). */
  max_temp?: number;
  seed?: number;
  logprobs?: boolean;
  top_logprobs?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
  stop?: string | string[];
  stop_token_ids?: number[];
  n?: number;
  /** OpenAI-compatible user id (discarded by Venice). */
  user?: string;
  /** OpenAI-compatible store flag (accepted but unused by Venice). */
  store?: boolean;
  /** OpenAI-compatible text configuration. */
  text?: TextConfig;
  /** OpenAI-compatible request to include additional response data. */
  include?: string[];
  /** OpenAI-compatible request tracking metadata. */
  metadata?: Record<string, string>;
  /** Signal to abort the request. */
  abortSignal?: AbortSignal;
}

export function buildChatCompletionBody(
  messages: Message[],
  options: ChatCompletionRequestOptions,
  stream: boolean
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.model || DEFAULT_MODELS.chat,
    messages,
    stream,
  };

  if (stream) {
    body.stream_options = { include_usage: true };
  }

  if (options.tools?.length) {
    body.tools = options.tools;
    body.tool_choice = options.tool_choice || 'auto';
  }

  const optionalFields: (keyof ChatCompletionRequestOptions)[] = [
    'venice_parameters', 'response_format', 'reasoning_effort', 'reasoning',
    'prompt_cache_key', 'prompt_cache_retention', 'parallel_tool_calls',
    'max_completion_tokens', 'max_tokens', 'temperature', 'top_p', 'top_k',
    'min_p', 'min_temp', 'max_temp', 'seed', 'logprobs', 'top_logprobs',
    'frequency_penalty', 'presence_penalty', 'repetition_penalty', 'stop',
    'stop_token_ids', 'n', 'user', 'store', 'text', 'include', 'metadata'
  ];

  for (const field of optionalFields) {
    if (options[field] !== undefined) {
      body[field] = options[field];
    }
  }

  return body;
}

async function readChatErrorBody(response: Response, signal?: AbortSignal): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const onAbort = () => {
    reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener('abort', onAbort);
  const decoder = new TextDecoder();
  let result = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += decoder.decode(value, { stream: true });
      if (result.length > 1024 * 1024) break;
    }
    result += decoder.decode();
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
  return result;
}

// Chat completion (non-streaming)
export async function chatCompletion(
  messages: Message[],
  options: ChatCompletionRequestOptions = {}
): Promise<{
  content: string;
  reasoning_content?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  finish_reason: string;
  /** X-Balance-Remaining / X-RateLimit-* reported by the API for this call. */
  usageHeaders?: UsageHeaders;
}> {
  const body = buildChatCompletionBody(messages, options, false);

  let capturedHeaders: UsageHeaders | undefined;
  const response = await apiRequest<{
    choices: Array<{
      message: { content: string; reasoning_content?: string; tool_calls?: any[] };
      finish_reason: string;
    }>;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    /** Error envelope returned with HTTP 200 — must not become silent output. */
    error?: { message?: string; code?: string };
  }>('/chat/completions', {
    method: 'POST',
    body,
    spinnerText: 'Thinking...',
    showSpinner: options.showSpinner,
    additionalHeaders: options.additionalHeaders,
    signal: options.abortSignal,
    onHeaders: (headers) => {
      capturedHeaders = parseUsageHeaders(headers);
    },
  });

  // A 200-with-error-envelope (e.g. a rate limit reported in the body after
  // headers flushed) must surface as a VeniceApiError, mirroring
  // chatCompletionStream. Otherwise `choice?.message?.content || ''` returns
  // empty output silently.
  if (response.error) {
    throw new VeniceApiError(
      response.error.message || JSON.stringify(response.error),
      undefined,
      response.error.code
    );
  }

  const choice = response.choices?.[0];
  const usage = response.usage;

  // Track usage
  if (usage) {
    trackUsage({
      command: 'chat',
      model: options.model || DEFAULT_MODELS.chat,
      ...usage,
    });
  }

  return {
    content: choice?.message?.content || '',
    reasoning_content: choice?.message?.reasoning_content,
    tool_calls: choice?.message?.tool_calls,
    usage,
    finish_reason: choice?.finish_reason || 'stop',
    ...(capturedHeaders && (capturedHeaders.balanceRemainingUsd !== undefined || capturedHeaders.rateLimit)
      ? { usageHeaders: capturedHeaders }
      : {}),
  };
}

// Chat completion (streaming)
export async function* chatCompletionStream(
  messages: Message[],
  options: ChatCompletionRequestOptions = {}
): AsyncGenerator<{
  content?: string;
  reasoning_content?: string;
  tool_calls?: any[];
  finish_reason?: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  completionId?: string;
  done: boolean;
  /** X-Balance-Remaining / X-RateLimit-* reported by the API for this call. */
  usageHeaders?: UsageHeaders;
}> {
  const body = buildChatCompletionBody(messages, options, true);

  const response = await apiRequest<Response>('/chat/completions', {
    method: 'POST',
    body,
    stream: true,
    showSpinner: false,
    additionalHeaders: options.additionalHeaders,
    signal: options.abortSignal,
  });

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    const errorBytes = await readChatErrorBody(response, options.abortSignal);
    if (options.abortSignal?.aborted) {
      // An intentional abort while reading the error envelope must surface as
      // an AbortError (VCL-002 semantics), not as a fabricated API error.
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      throw abortError;
    }
    throw VeniceApiError.fromResponse(response, errorBytes);
  }

  const usageHeaders = parseUsageHeaders(response.headers);

  let totalUsage: any = null;
  let completionId: string | undefined;
  // R2-010: SSE events are assembled as complete frames (blank-line delimited,
  // CRLF-tolerant, multi-line `data:` lines joined with `\n`), and a clean
  // protocol terminal ([DONE] or a finish_reason) is tracked explicitly so
  // unexpected EOF is reported as truncation instead of fake success.
  let sawTerminalMarker = false;

  // Decode one complete SSE data payload. Returns the deltas to yield; throws
  // for malformed frames and mid-stream json.error payloads (VC-KIMI-031).
  const decodeFrame = (data: string): Array<{
    content?: string;
    reasoning_content?: string;
    tool_calls?: any[];
    finish_reason?: string;
  }> => {
    if (data === '[DONE]') {
      sawTerminalMarker = true;
      return [];
    }
    if (!data.trim()) return [];
    let json: any;
    try {
      json = JSON.parse(data);
    } catch {
      // VC-KIMI-031: never silently drop malformed SSE frames. Surface a
      // bounded snippet so tool calls, text, usage, or finish reasons are
      // not lost without notice.
      const snippet = data.length > 200 ? `${data.slice(0, 200)}…` : data;
      throw new Error(`Malformed SSE frame from API: ${snippet}`);
    }

    if (json.error) {
      const streamError = new VeniceApiError(
        json.error.message || JSON.stringify(json.error),
        undefined,
        json.error.code
      );
      streamError.cause = 'The Venice API returned an error during the stream';
      streamError.fix = 'Retry the request; if the error persists, check the model and your quota.';
      streamError.debug = json.error.code ? `Code: ${json.error.code}` : undefined;
      throw streamError;
    }

    const choice = json.choices?.[0];
    const delta = choice?.delta;

    // Capture completion ID for E2EE signature verification
    if (json.id && !completionId) {
      completionId = json.id;
    }

    if (json.usage) {
      totalUsage = json.usage;
    }

    const out: Array<{
      content?: string;
      reasoning_content?: string;
      tool_calls?: any[];
      finish_reason?: string;
    }> = [];
    if (delta?.reasoning_content) out.push({ reasoning_content: delta.reasoning_content });
    if (delta?.content) out.push({ content: delta.content });
    if (delta?.tool_calls) out.push({ tool_calls: delta.tool_calls });
    if (choice?.finish_reason) {
      // A finish reason is a valid protocol terminal marker (R2-010).
      sawTerminalMarker = true;
      out.push({ finish_reason: choice.finish_reason });
    }
    return out;
  };

  for await (const frame of readSseFrames(response, options.abortSignal)) {
    for (const item of decodeFrame(frame)) {
      yield { ...item, done: false, completionId };
    }
  }

  // R2-010: EOF without a clean terminal marker is truncation, never success.
  // An intentional abort cancels the reader (inside readSseFrames) instead.
  if (!sawTerminalMarker && !options.abortSignal?.aborted) {
    throw new VeniceApiError(
      'Stream ended before a completion marker (connection truncated)',
      502,
      'STREAM_TRUNCATED'
    );
  }
  if (totalUsage) {
    trackUsage({
      command: 'chat',
      model: options.model || DEFAULT_MODELS.chat,
      ...totalUsage,
    });
  }
  yield { done: true, usage: totalUsage, completionId, usageHeaders };
}

// Image generation (Venice-native endpoint)
export function buildImageGenerationBody(
  prompt: string,
  options: Omit<ImageGenerationOptions, 'output'> = {}
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.model || DEFAULT_MODELS.image,
    prompt,
    format: options.format || 'png',
  };

  const optionalFields: Array<[keyof Omit<ImageGenerationOptions, 'output'>, string]> = [
    ['width', 'width'],
    ['height', 'height'],
    ['aspectRatio', 'aspect_ratio'],
    ['resolution', 'resolution'],
    ['quality', 'quality'],
    ['stylePreset', 'style_preset'],
    ['styleReferences', 'style_references'],
    ['negativePrompt', 'negative_prompt'],
    ['seed', 'seed'],
    ['cfgScale', 'cfg_scale'],
    ['steps', 'steps'],
    ['loraStrength', 'lora_strength'],
    ['hideWatermark', 'hide_watermark'],
    ['safeMode', 'safe_mode'],
    ['embedExifMetadata', 'embed_exif_metadata'],
  ];

  for (const [optionName, fieldName] of optionalFields) {
    const value = options[optionName];
    if (value !== undefined) {
      body[fieldName] = value;
    }
  }

  if (options.safeMode === undefined) {
    const safeMode = getConfigValue('media_safe_mode');
    if (safeMode !== undefined) {
      body.safe_mode = safeMode;
    }
  }

  if (options.count !== undefined && options.count > 1) {
    body.variants = options.count;
  }

  return body;
}

export async function generateImage(
  prompt: string,
  options: Omit<ImageGenerationOptions, 'output'> = {},
  signal?: AbortSignal
): Promise<string[]> {
  const body = buildImageGenerationBody(prompt, options);

  const response = await apiRequest<{
    id: string;
    images: string[];
  }>('/image/generate', {
    method: 'POST',
    body,
    spinnerText: 'Generating image...',
    signal,
  });

  trackUsage({
    command: 'image',
    model: options.model || DEFAULT_MODELS.image,
  });

  return response.images;
}

type ImageEditOptions = {
  model?: string;
  aspectRatio?: string;
  enhancePrompt?: boolean;
  safeMode?: boolean;
};

async function readImageAsBase64(imagePath: string): Promise<string> {
  const fs = await import('fs');

  if (!fs.existsSync(imagePath)) {
    throw new Error(`File not found: ${imagePath}`);
  }
  assertFileSizeWithinLimit(imagePath, MAX_IMAGE_EDIT_BYTES, 'Image file');
  return (await fs.promises.readFile(imagePath)).toString('base64');
}

// Edit a single local image
export async function editImage(
  imagePath: string,
  prompt: string,
  options: ImageEditOptions = {},
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  const body: Record<string, unknown> = {
    image: await readImageAsBase64(imagePath),
    prompt,
  };
  if (options.model) body.model = options.model;
  if (options.aspectRatio) body.aspect_ratio = options.aspectRatio;
  if (options.enhancePrompt) body.enhance_prompt = true;
  if (options.safeMode === false) {
    body.safe_mode = false;
  } else if (options.safeMode === undefined) {
    const safeMode = getConfigValue('media_safe_mode');
    if (safeMode !== undefined) body.safe_mode = safeMode;
  }

  const response = await apiRequest<ArrayBuffer>('/image/edit', {
    method: 'POST',
    body,
    responseType: 'arrayBuffer',
    maxResponseBytes: MAX_IMAGE_DOWNLOAD_BYTES,
    responseLabel: 'Edited image',
    expectedContentType: 'image',
    spinnerText: 'Editing image...',
    signal,
  });

  trackUsage({ command: 'image edit', model: options.model || 'default' });
  return response;
}

// Edit using one to three local image layers
export async function multiEditImage(
  imagePaths: string[],
  prompt: string,
  options: ImageEditOptions = {}
): Promise<ArrayBuffer> {
  if (imagePaths.length < 1 || imagePaths.length > 3) {
    throw new Error('Multi-edit requires between 1 and 3 images.');
  }

  const body: Record<string, unknown> = {
    images: await Promise.all(imagePaths.map(readImageAsBase64)),
    prompt,
  };
  if (options.model) body.modelId = options.model;
  if (options.aspectRatio) body.aspect_ratio = options.aspectRatio;
  if (options.enhancePrompt) body.enhance_prompt = true;
  if (options.safeMode === false) {
    body.safe_mode = false;
  } else if (options.safeMode === undefined) {
    const safeMode = getConfigValue('media_safe_mode');
    if (safeMode !== undefined) body.safe_mode = safeMode;
  }

  const response = await apiRequest<ArrayBuffer>('/image/multi-edit', {
    method: 'POST',
    body,
    responseType: 'arrayBuffer',
    maxResponseBytes: MAX_IMAGE_DOWNLOAD_BYTES,
    responseLabel: 'Edited image',
    expectedContentType: 'image',
    spinnerText: 'Editing image layers...',
  });

  trackUsage({ command: 'image multi-edit', model: options.model || 'default' });
  return response;
}

// Remove the background from a local image
export async function removeImageBackground(imagePath: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const response = await apiRequest<ArrayBuffer>('/image/background-remove', {
    method: 'POST',
    body: { image: await readImageAsBase64(imagePath) },
    responseType: 'arrayBuffer',
    maxResponseBytes: MAX_IMAGE_DOWNLOAD_BYTES,
    responseLabel: 'Background removal image',
    expectedContentType: 'image',
    spinnerText: 'Removing background...',
    signal,
  });

  trackUsage({ command: 'image bg-remove', model: 'background-remove' });
  return response;
}

// List style presets accepted by image generation
export async function listImageStyles(): Promise<string[]> {
  const response = await apiRequest<{ data: string[] }>('/image/styles', {
    showSpinner: false,
    authenticated: false,
  });
  return response.data || [];
}

export type UpscaleImageResult = {
  bytes: Buffer;
  contentType: string;
};

// Image upscale
export async function upscaleImage(
  imagePath: string,
  options: {
    model?: string;
    scale?: number;
  } = {},
  signal?: AbortSignal
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
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', () => controller.abort(), { once: true });

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
      throw VeniceApiError.fromResponse(response, errorBody);
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
      model: options.model || DEFAULT_MODELS.imageUpscale,
    });

    return {
      bytes,
      contentType: contentType.split(';')[0].trim() || 'image/png',
    };
  } catch (error) {
    if (spinner) stopSpinner(false);
    if (error instanceof Error && error.name === 'AbortError') {
      if (signal?.aborted) throw error;
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
    format?: 'mp3' | 'wav' | 'opus' | 'aac' | 'flac' | 'pcm';
    speed?: number;
    temperature?: number;
    streaming?: boolean;
  } = {},
  signal?: AbortSignal
): Promise<{ audio: ArrayBuffer; contentType?: string }> {
  const body: Record<string, unknown> = {
    model: options.model || DEFAULT_MODELS.tts,
    input: text,
    voice: options.voice || DEFAULT_MODELS.voice,
  };
  if (options.format !== undefined) {
    body.response_format = options.format;
  }
  if (options.speed !== undefined) {
    body.speed = options.speed;
  }
  if (options.temperature !== undefined) {
    body.temperature = options.temperature;
  }
  if (options.streaming !== undefined) {
    body.streaming = options.streaming;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    const response = await fetch(`${VENICE_API}/audio/speech`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBytes = await readResponseBodyWithLimit(
        response,
        MAX_AUDIO_DOWNLOAD_BYTES,
        'Text-to-speech API error response'
      );
      throw VeniceApiError.fromResponse(response, errorBytes.toString('utf-8'));
    }

    const contentType = response.headers.get('content-type')?.split(';')[0].trim();
    if (
      !contentType ||
      (!contentType.toLowerCase().startsWith('audio/') &&
        contentType.toLowerCase() !== 'application/octet-stream')
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(
        `Text-to-speech returned an unexpected Content-Type: ${contentType || 'missing'}.`
      );
    }
    const bytes = await readResponseBodyWithLimit(
      response,
      MAX_AUDIO_DOWNLOAD_BYTES,
      'Text-to-speech audio'
    );
    if (bytes.length === 0) {
      throw new Error('Text-to-speech response was empty.');
    }

    trackUsage({
      command: 'tts',
      model: options.model || DEFAULT_MODELS.tts,
    });

    return {
      audio: Uint8Array.from(bytes).buffer,
      contentType,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      if (signal?.aborted) throw error;
      throw new Error('Text-to-speech request timed out. Please try with shorter text.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Create a model-specific voice handle from a reference audio sample
export async function cloneVoice(
  audioPath: string,
  options: { model?: string } = {}
): Promise<{ id: string; model: string }> {
  const fs = await import('fs');
  const path = await import('path');

  if (!fs.existsSync(audioPath)) {
    throw new Error(`File not found: ${audioPath}`);
  }

  const acceptedExtensions = new Set(['.mp3', '.wav', '.flac', '.mp4']);
  const extension = path.extname(audioPath).toLowerCase();
  if (!acceptedExtensions.has(extension)) {
    throw new Error(
      `Unsupported voice sample format "${extension || '(none)'}". ` +
      'Use MP3, WAV, FLAC, or MP4.'
    );
  }

  assertFileSizeWithinLimit(
    audioPath,
    MAX_VOICE_SAMPLE_BYTES,
    'Voice reference sample'
  );
  const audioData = await fs.promises.readFile(audioPath);
  const form = new FormData();
  form.append('model', options.model || DEFAULT_MODELS.voiceClone);
  form.append(
    'file',
    new Blob([new Uint8Array(audioData)], { type: mimeTypeFromPath(audioPath) }),
    path.basename(audioPath)
  );

  const spinner = startSpinner('Cloning voice...');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${VENICE_API}/audio/voices`, {
      method: 'POST',
      headers: getHeaders(true, ''),
      body: form,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw VeniceApiError.fromResponse(response, errorBody);
    }

    if (spinner) stopSpinner(true);
    return await response.json() as { id: string; model: string };
  } catch (error) {
    if (spinner) stopSpinner(false);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Voice cloning request timed out. Try a shorter audio sample.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Transcription (STT) -- requires multipart/form-data upload
export async function transcribe(
  audioPath: string,
  options: {
    model?: string;
    language?: string;
    timestamps?: boolean;
  } = {},
  signal?: AbortSignal
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
    ['model', options.model || DEFAULT_MODELS.transcription],
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
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    const requestInit: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: {
        ...getHeaders(true, ''),
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
      throw VeniceApiError.fromResponse(res, errorBody);
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
      model: options.model || DEFAULT_MODELS.transcription,
    });

    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (spinner) stopSpinner(false);
    if (error instanceof Error && error.name === 'AbortError') {
      if (signal?.aborted) throw error;
      throw new Error('Transcription request timed out. Try a shorter audio file.');
    }
    throw error;
  }
}

// Embeddings
export type EmbeddingResult =
  | { index: number; encoding: 'float'; embedding: number[] }
  | { index: number; encoding: 'base64'; embedding: string };

export async function generateEmbeddings(
  input: string | string[],
  options: {
    model?: string;
    dimensions?: number;
    encoding_format?: 'float' | 'base64';
  } = {}
): Promise<EmbeddingResult[]> {
  const model = options.model || DEFAULT_MODELS.embedding;
  const encodingFormat = options.encoding_format ?? 'float';
  const body: Record<string, unknown> = {
    model,
    input: Array.isArray(input) ? input : [input],
  };

  if (options.dimensions) body.dimensions = options.dimensions;
  body.encoding_format = encodingFormat;

  const response = await apiRequest<{
    data: Array<{ embedding: number[] | string; index: number }>;
  }>('/embeddings', {
    method: 'POST',
    body,
    spinnerText: 'Generating embeddings...',
  });

  trackUsage({
    command: 'embeddings',
    model,
  });

  return response.data.map((item) =>
    encodingFormat === 'base64'
      ? {
          index: item.index,
          encoding: 'base64' as const,
          embedding: String(item.embedding),
        }
      : {
          index: item.index,
          encoding: 'float' as const,
          embedding: item.embedding as number[],
        }
  );
}

const MODELS_CACHE_TTL_MS = 60_000;
let modelsCache: { models: Model[]; fetchedAt: number } | null = null;

export async function listModelTraits(
  options: { showSpinner?: boolean; type?: string } = {}
): Promise<any> {
  const { showSpinner = true, type } = options;
  const url = type ? `/models/traits?type=${encodeURIComponent(type)}` : '/models/traits';
  const response = await apiRequest<any>(url, {
    method: 'GET',
    spinnerText: 'Fetching model traits...',
    showSpinner,
  });
  return response?.data || response || [];
}

export function clearModelsCache(): void {
  modelsCache = null;
}

function mergeModel(merged: Map<string, Model>, model: Model, requestedType?: string): void {
  const normalized: Model = { ...model };

  // Only backfill missing types from typed endpoints. Never overwrite explicit
  // payload types (including "text"), because mixed endpoint responses would
  // otherwise be silently misclassified.
  if (requestedType && !normalized.type) {
    normalized.type = requestedType;
  }

  const key = normalized.id || JSON.stringify(normalized);
  const existing = merged.get(key);

  if (!existing) {
    merged.set(key, normalized);
    return;
  }

  const existingType = (existing.type || '').toLowerCase();
  const normalizedType = (normalized.type || '').toLowerCase();
  if (existingType === 'text' && normalizedType && normalizedType !== 'text') {
    merged.set(key, normalized);
  }
}

// List models
export async function listModels(
  options: { showSpinner?: boolean; type?: string; bypassCache?: boolean } = {}
): Promise<Model[]> {
  const { showSpinner: showSpinnerOption = true, type, bypassCache = false } = options;

  if (type) {
    const response = await apiRequest<{ data: Model[] }>(
      `/models?type=${encodeURIComponent(type)}`,
      {
        method: 'GET',
        spinnerText: 'Fetching models...',
        showSpinner: showSpinnerOption,
      }
    );
    return (response.data || []).map((model) =>
      !model.type ? { ...model, type } : model
    );
  }

  if (!bypassCache && modelsCache && Date.now() - modelsCache.fetchedAt < MODELS_CACHE_TTL_MS) {
    return [...modelsCache.models];
  }

  const modelTypes = ['text', 'asr', 'embedding', 'image', 'tts', 'upscale', 'inpaint', 'video', 'music'];
  const merged = new Map<string, Model>();

  const base = apiRequest<{ data: Model[] }>('/models', {
    method: 'GET',
    spinnerText: 'Fetching models...',
    showSpinner: showSpinnerOption,
  });

  const typed = modelTypes.map((type) =>
    apiRequest<{ data: Model[] }>(`/models?type=${encodeURIComponent(type)}`, {
      method: 'GET',
      showSpinner: false,
    })
      .then((response) => ({ type, response }))
      .catch(() => null)
  );

  const [baseResponse, ...typedResponses] = await Promise.all([base, ...typed]);

  for (const model of baseResponse.data || []) {
    mergeModel(merged, model);
  }

  for (const entry of typedResponses) {
    if (!entry) continue;
    for (const model of entry.response.data || []) {
      mergeModel(merged, model, entry.type);
    }
  }

  const models = Array.from(merged.values());
  modelsCache = { models, fetchedAt: Date.now() };
  return [...models];
}

// List TTS models and their model-specific voice catalogs
export async function listTtsModels(): Promise<Model[]> {
  const response = await apiRequest<{ data: Model[] }>('/models?type=tts', {
    method: 'GET',
    spinnerText: 'Fetching voices...',
  });

  return (response.data || []).map((model) => ({
    ...model,
    type: model.type && model.type.toLowerCase() !== 'text' ? model.type : 'tts',
  }));
}

export type ListCharactersOptions = {
  search?: string;
  limit?: number;
  offset?: number;
  showSpinner?: boolean;
};

function clampCharacterLimit(limit?: number): number {
  const value = limit ?? 50;
  if (!Number.isFinite(value)) return 50;
  return Math.min(Math.max(Math.trunc(value), 1), 100);
}

function clampCharacterOffset(offset?: number): number {
  if (offset === undefined || !Number.isFinite(offset)) return 0;
  return Math.max(Math.trunc(offset), 0);
}

export async function listCharacters(
  options: ListCharactersOptions = {}
): Promise<Character[]> {
  const params = new URLSearchParams();
  params.set('limit', String(clampCharacterLimit(options.limit)));
  params.set('offset', String(clampCharacterOffset(options.offset)));
  if (options.search) {
    params.set('search', options.search);
  }

  const response = await apiRequest<{ data: Character[] }>(`/characters?${params}`, {
    method: 'GET',
    spinnerText: 'Fetching characters...',
    showSpinner: options.showSpinner ?? true,
  });
  return response.data || [];
}

export async function getCharacter(
  slug: string,
  options: { showSpinner?: boolean } = {}
): Promise<Character> {
  const response = await apiRequest<{ data: Character }>(
    `/characters/${encodeURIComponent(slug)}`,
    {
      method: 'GET',
      spinnerText: 'Fetching character...',
      showSpinner: options.showSpinner ?? true,
    }
  );
  return response.data;
}

export async function getCharacterReviews(
  slug: string,
  options: { page?: number; pageSize?: number; showSpinner?: boolean } = {}
): Promise<CharacterReviewsPage> {
  const params = new URLSearchParams();
  if (options.page !== undefined) {
    params.set('page', String(options.page));
  }
  if (options.pageSize !== undefined) {
    params.set('pageSize', String(options.pageSize));
  }
  const query = params.toString();
  const endpoint = `/characters/${encodeURIComponent(slug)}/reviews${query ? `?${query}` : ''}`;

  return apiRequest<CharacterReviewsPage>(endpoint, {
    method: 'GET',
    spinnerText: 'Fetching reviews...',
    showSpinner: options.showSpinner ?? true,
  });
}

export type VideoStatusResult = {
  status: string;
  average_execution_time?: number;
  execution_duration?: number;
  video_url?: string;
  url?: string;
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

export function videoUrlFromStatus(status: VideoStatusResult): string | undefined {
  return status.video_url || status.url || status.download_url;
}

async function retrieveVideoResponse(
  queueId: string,
  model: string,
  options: {
    spinnerText?: string;
    statusOnly?: boolean;
    outputPath?: string;
    maxBytes?: number;
    signal?: AbortSignal;
  } = {}
): Promise<VideoRetrieveResult> {
  const spinner = startSpinner(options.spinnerText || 'Checking video status...');
  // Retrieval must never delete the remote media. Callers can explicitly
  // complete the job only after the response is safely persisted locally.
  const body: Record<string, unknown> = {
    queue_id: queueId,
    model,
    delete_media_on_completion: false,
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener('abort', () => controller.abort(), { once: true });
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
        throw VeniceApiError.fromResponse(response, errorBody);
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
        ), options.signal);
        if (options.signal?.aborted) throw new Error('The operation was aborted');
        continue;
      }

      if (spinner) stopSpinner(false);
      if (error instanceof Error && error.name === 'AbortError') {
        if (options.signal?.aborted) throw error;
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
  } = {},
  signal?: AbortSignal
): Promise<{ queue_id: string; model: string }> {
  const body: Record<string, unknown> = {
    model: options.model || DEFAULT_MODELS.textToVideo,
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
    signal,
  });

  trackUsage({
    command: 'video',
    model: options.model || DEFAULT_MODELS.textToVideo,
  });

  return response;
}

export async function queueVideoUpscale(
  videoUrl: string,
  options: {
    model?: string;
    upscaleFactor?: number;
  } = {}
): Promise<{ queue_id: string; model: string }> {
  const model = options.model || DEFAULT_MODELS.videoUpscale;
  const response = await apiRequest<{ queue_id: string; model: string }>('/video/queue', {
    method: 'POST',
    body: {
      model,
      video_url: videoUrl,
      upscale_factor: options.upscaleFactor ?? 2,
    },
    spinnerText: 'Queueing video upscale...',
  });

  trackUsage({ command: 'video', model });
  return response;
}

export async function quoteVideoGeneration(options: {
  model: string;
  duration: string;
  aspectRatio?: string;
  resolution?: string;
  upscaleFactor?: number;
  audio?: boolean;
  videoUrl?: string;
}): Promise<{ quote: number }> {
  const body: Record<string, unknown> = {
    model: options.model,
    duration: options.duration,
  };
  if (options.aspectRatio) body.aspect_ratio = options.aspectRatio;
  if (options.resolution) body.resolution = options.resolution;
  if (options.upscaleFactor !== undefined) body.upscale_factor = options.upscaleFactor;
  if (options.audio !== undefined) body.audio = options.audio;
  if (options.videoUrl) body.video_url = options.videoUrl;

  return apiRequest('/video/quote', {
    method: 'POST',
    body,
    spinnerText: 'Fetching video quote...',
  });
}

export async function completeVideo(
  queueId: string,
  model: string,
  signal?: AbortSignal
): Promise<{ success: boolean }> {
  return apiRequest('/video/complete', {
    method: 'POST',
    body: { queue_id: queueId, model },
    spinnerText: 'Cleaning up video...',
    signal,
  });
}

export async function transcribeVideo(
  url: string
): Promise<{ transcript: string; lang?: string }> {
  return apiRequest('/video/transcriptions', {
    method: 'POST',
    body: { url, response_format: 'json' },
    spinnerText: 'Transcribing video...',
  });
}

// Video generation - check status / retrieve result
export async function getVideoStatus(
  queueId: string,
  model: string,
  signal?: AbortSignal
): Promise<VideoStatusResult> {
  const result = await retrieveVideoResponse(queueId, model, {
    spinnerText: 'Checking video status...',
    statusOnly: true,
    signal,
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
    outputPath?: string;
    maxBytes?: number;
  } = {},
  signal?: AbortSignal
): Promise<VideoRetrieveResult> {
  return retrieveVideoResponse(queueId, model, {
    spinnerText: 'Retrieving video...',
    outputPath: options.outputPath,
    maxBytes: options.maxBytes,
    signal,
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
  options: AudioGenerationOptions,
  signal?: AbortSignal
): Promise<{ model: string; queue_id: string; status: string }> {
  const response = await apiRequest<{
    model: string;
    queue_id: string;
    status: string;
  }>('/audio/queue', {
    method: 'POST',
    body: audioGenerationBody(prompt, options),
    spinnerText: 'Queueing audio generation...',
    signal,
  });

  trackUsage({ command: 'music', model: options.model });
  return response;
}

// Music and sound effects - retrieve processing status or completed binary audio
export async function retrieveGeneratedAudio(
  queueId: string,
  model: string,
  signal?: AbortSignal
): Promise<AudioRetrieveResult> {
  const response = await apiRequest<Response>('/audio/retrieve', {
    method: 'POST',
    body: { queue_id: queueId, model, delete_media_on_completion: false },
    stream: true,
    showSpinner: false,
    signal,
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
  model: string,
  signal?: AbortSignal
): Promise<{ success: boolean }> {
  return apiRequest('/audio/complete', {
    method: 'POST',
    body: { queue_id: queueId, model },
    spinnerText: 'Cleaning up generated audio...',
    signal,
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

export type WebSearchResult = {
  title: string;
  url: string;
  content: string;
  date: string;
};

export type DedicatedWebSearchResponse = {
  query: string;
  results: WebSearchResult[];
};

// Web search without model inference
export async function dedicatedWebSearch(
  query: string,
  options: {
    limit?: number;
    provider?: 'brave' | 'google';
  } = {},
  signal?: AbortSignal
): Promise<DedicatedWebSearchResponse> {
  return apiRequest<DedicatedWebSearchResponse>('/augment/search', {
    method: 'POST',
    body: {
      query,
      limit: options.limit ?? 10,
      search_provider: options.provider ?? 'brave',
    },
    spinnerText: 'Searching the web...',
    signal,
  });
}

export type WebScrapeResponse = {
  url: string;
  content: string;
  format: 'markdown';
};

// Scrape a public page to Markdown without model inference
export async function scrapeWebPage(url: string, signal?: AbortSignal): Promise<WebScrapeResponse> {
  return apiRequest<WebScrapeResponse>('/augment/scrape', {
    method: 'POST',
    body: { url },
    spinnerText: 'Scraping page...',
    signal,
  });
}

export type DocumentParseResponse = {
  text: string;
  tokens: number;
};

function sanitizeMultipartFilename(filename: string): string {
  return filename.replace(/[\u0000-\u001f\u007f"\\]/g, '_');
}

// Parse a document without model inference
export async function parseDocument(filePath: string): Promise<DocumentParseResponse> {
  const fs = await import('fs');
  const path = await import('path');
  const crypto = await import('crypto');

  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const fileSize = assertFileSizeWithinLimit(
    filePath,
    MAX_DOCUMENT_PARSE_BYTES,
    'Document'
  );
  const filename = path.basename(filePath);
  const mimeType = mimeTypeFromPath(filePath);
  const boundary = `----venice-cli-${crypto.randomUUID()}`;
  const CRLF = '\r\n';
  const safeFilename = sanitizeMultipartFilename(filename);
  const headerBuffer = Buffer.from(
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="response_format"${CRLF}${CRLF}` +
    `json${CRLF}` +
    `--${boundary}${CRLF}` +
    `Content-Disposition: form-data; name="file"; filename="${safeFilename}"${CRLF}` +
    `Content-Type: ${mimeType}${CRLF}${CRLF}`,
    'utf-8'
  );
  const footerBuffer = Buffer.from(`${CRLF}--${boundary}--${CRLF}`, 'utf-8');
  const contentLength = headerBuffer.length + fileSize + footerBuffer.length;
  const multipartBody = Readable.from((async function* () {
    yield headerBuffer;
    for await (const chunk of fs.createReadStream(filePath)) {
      yield chunk;
    }
    yield footerBuffer;
  })());

  const spinner = startSpinner('Parsing document...');
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DOCUMENT_PARSE_TIMEOUT_MS);

  try {
    const requestInit: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: {
        ...getHeaders(true, ''),
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(contentLength),
      },
      body: multipartBody as unknown as RequestInit['body'],
      duplex: 'half',
      signal: controller.signal,
    };
    const response = await fetch(`${VENICE_API}/augment/text-parser`, requestInit);
    const responseBytes = await readResponseBodyWithLimit(
      response,
      MAX_DOCUMENT_PARSE_RESPONSE_BYTES,
      response.ok ? 'Document parse response' : 'Document parse API error response'
    );

    if (!response.ok) {
      throw VeniceApiError.fromResponse(response, responseBytes.toString('utf-8'));
    }

    const responseBody = responseBytes.toString('utf-8');
    if (responseBody.trim().length === 0) {
      throw new Error('Document parse response was empty; expected JSON.');
    }

    let parsedResponse: DocumentParseResponse;
    try {
      parsedResponse = JSON.parse(responseBody) as DocumentParseResponse;
    } catch {
      throw new Error('Document parse response contained malformed JSON.');
    }

    if (spinner) stopSpinner(true);
    return parsedResponse;
  } catch (error) {
    if (spinner) stopSpinner(false);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        'Document parsing timed out after 10 minutes. ' +
        'Check your connection or try a smaller document.'
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
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

export type JsonRpcRequest = {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
  id: number | string;
};

export type JsonRpcErrorObject = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc?: string;
  id?: number | string;
  result?: unknown;
  error?: JsonRpcErrorObject;
};

export async function listModelCompatibilityMappings(): Promise<Record<string, string>> {
  const data = await apiRequest<Record<string, string>>('/models/compatibility_mapping', {
    method: 'GET',
    spinnerText: 'Fetching model compatibility mappings...',
  });
  return data;
}

export type CryptoRpcResult = {
  body: JsonRpcResponse | JsonRpcResponse[];
  credits?: string;
  costUsd?: string;
  requestId?: string;
};

export async function listCryptoNetworks(): Promise<string[]> {
  const response = await apiRequest<{ networks?: string[] }>('/crypto/rpc/networks', {
    method: 'GET',
    authenticated: false,
    spinnerText: 'Fetching RPC networks...',
  });
  return response.networks ?? [];
}

export async function cryptoRpc(
  network: string,
  body: JsonRpcRequest | JsonRpcRequest[]
): Promise<CryptoRpcResult> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(network)) {
    throw new Error(
      'Invalid RPC network slug. Use "venice rpc networks" to list supported networks.'
    );
  }

  let credits: string | undefined;
  let costUsd: string | undefined;
  let requestId: string | undefined;

  const data = await apiRequest<JsonRpcResponse | JsonRpcResponse[]>(
    `/crypto/rpc/${encodeURIComponent(network)}`,
    {
      method: 'POST',
      body,
      spinnerText: 'Sending RPC request...',
      onHeaders: (headers) => {
        credits = headers.get('x-venice-rpc-credits') ?? undefined;
        costUsd = headers.get('x-venice-rpc-cost-usd') ?? undefined;
        requestId = headers.get('x-request-id') ?? undefined;
      },
    }
  );

  return { body: data, credits, costUsd, requestId };
}
