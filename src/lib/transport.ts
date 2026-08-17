/**
 * Venice API transport layer.
 *
 * Owns the mechanics of talking to the API — auth headers, bounded body
 * reading, retry/backoff/abort, idle timeouts, and SSE frame assembly — so the
 * endpoint functions in `api.ts` can stay thin adapters that only describe
 * "what to send" and "what comes back".
 */

import {
  getVeniceAuth,
  requireAuth,
  applyVeniceAuth,
} from './config.js';
import { startSpinner, stopSpinner } from './output.js';
import { getVersion } from './version.js';
import { formatBytes } from './media.js';

// Never allow production environment variables to redirect bearer credentials.
export const VENICE_API =
  process.env.NODE_ENV === 'test' && process.env.VENICE_API_BASE_URL
    ? process.env.VENICE_API_BASE_URL
    : 'https://api.venice.ai/api/v1';
export const MAX_RETRIES = 3;
export const RETRY_DELAY_MS = 1000;
const MAX_RETRY_AFTER_SECONDS = 300;
export const DEFAULT_TIMEOUT_MS = 120000; // 2 minutes default timeout

/**
 * Structured error contract (P2): every API error carries an actionable
 * `cause`/`fix`/`debug` triple so callers and the UI can show recovery steps
 * instead of a bare message. `describe()` renders it as plain text.
 */
export interface VeniceErrorContract {
  cause?: string;
  fix?: string;
  debug?: string;
}

export class VeniceApiError extends Error implements VeniceErrorContract {
  public retryAfter?: number;
  public cause?: string;
  public fix?: string;
  public debug?: string;

  constructor(
    message: string,
    public statusCode?: number,
    public code?: string,
    retryAfter?: number
  ) {
    super(message);
    this.name = 'VeniceApiError';
    this.retryAfter = retryAfter;
  }

  static fromResponse(response: Response, body: string): VeniceApiError {
    const status = response.status;
    const retryAfter = parseRetryAfterHeader(response.headers.get('retry-after'));

    let error: VeniceApiError;
    try {
      const json = JSON.parse(body);
      const message = json.error?.message || json.message || body;
      const code = json.error?.code;
      error = new VeniceApiError(message, status, code, retryAfter);
    } catch {
      error = new VeniceApiError(body || `HTTP ${status}`, status, undefined, retryAfter);
    }
    applyStatusContract(error, status, retryAfter);
    return error;
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

  /** Render the cause/fix/debug contract as a single human-readable string. */
  describe(): string {
    const parts = [
      this.cause ? `Cause: ${this.cause}` : undefined,
      this.fix ? `Fix: ${this.fix}` : undefined,
      this.debug ? `Debug: ${this.debug}` : undefined,
    ].filter((part): part is string => Boolean(part));
    return parts.length ? parts.join('\n') : this.message;
  }
}

/** Attach the cause/fix/debug contract for well-known HTTP statuses. */
function applyStatusContract(error: VeniceApiError, status: number, retryAfter?: number): void {
  if (status === 401 || status === 403) {
    error.cause = 'Authentication was rejected by the Venice API';
    error.fix =
      'Check VENICE_API_KEY / X_SIGN_IN_WITH_X, or run `venice config set api_key`; the credential may be invalid or expired.';
    error.debug = `HTTP ${status}`;
  } else if (status === 429) {
    error.cause = 'The Venice API rate limit was exceeded';
    error.fix = 'Wait for the retry-after window (or slow the request rate) and retry.';
    error.debug = retryAfter ? `Retry-After: ${retryAfter}s` : 'No Retry-After header';
  } else if (status >= 500 && status < 600) {
    error.cause = 'The Venice API reported a server error';
    error.fix = 'Retry after a short delay; if it persists, check https://status.venice.ai.';
    error.debug = `HTTP ${status}`;
  }
}

/**
 * Shared auth header builder. Every direct API path must route through this so
 * api-key and x402 authentication behave identically (VC-KIMI-016).
 */
export function getHeaders(
  authenticated = true,
  contentType = 'application/json'
): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': `venice-cli/${getVersion()}`,
  };
  if (contentType) {
    headers['Content-Type'] = contentType;
  }
  if (authenticated) {
    const auth = getVeniceAuth();
    if (!auth) {
      // Trigger the throw for missing auth
      requireAuth();
    } else {
      applyVeniceAuth(headers, auth);
    }
  }
  return headers;
}

/**
 * Usage/billing headers reported by the API on inference responses.
 *
 * `X-Balance-Remaining` is only present for x402 wallet auth and carries the
 * USDC credit balance left after the request. `X-RateLimit-*` headers are set
 * when a rate-limit response is returned; parsing them defensively means any
 * future success-path rate info also surfaces (VC-AUD-037 parity).
 */
export interface UsageHeaders {
  /** Remaining x402 credit balance in USD after this request (x402 auth only). */
  balanceRemainingUsd?: number;
  /** Per-minute request cap information when the API includes it. */
  rateLimit?: {
    /** Per-minute request cap for the caller's tier. */
    limit?: number;
    /** Requests remaining in the current 60-second window. */
    remaining?: number;
    /** Unix timestamp (seconds) when the current window resets. */
    reset?: number;
  };
}

/** Parse X-Balance-Remaining / X-RateLimit-* into a typed UsageHeaders object. */
export function parseUsageHeaders(headers: Headers): UsageHeaders {
  const parsed: UsageHeaders = {};

  const balance = headers.get('x-balance-remaining');
  if (balance) {
    const value = Number(balance);
    if (Number.isFinite(value)) parsed.balanceRemainingUsd = value;
  }

  const limit = headers.get('x-ratelimit-limit');
  const remaining = headers.get('x-ratelimit-remaining');
  const reset = headers.get('x-ratelimit-reset');
  if (limit !== null || remaining !== null || reset !== null) {
    const rateLimit: NonNullable<UsageHeaders['rateLimit']> = {};
    if (limit !== null) {
      const value = Number(limit);
      if (Number.isFinite(value)) rateLimit.limit = value;
    }
    if (remaining !== null) {
      const value = Number(remaining);
      if (Number.isFinite(value)) rateLimit.remaining = value;
    }
    if (reset !== null) {
      const value = Number(reset);
      if (Number.isFinite(value)) rateLimit.reset = value;
    }
    parsed.rateLimit = rateLimit;
  }

  return parsed;
}

function parseRetryAfterHeader(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;

  // delta-seconds (integer or decimal)
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const seconds = parseFloat(trimmed);
    if (!Number.isFinite(seconds) || seconds < 0) return undefined;
    return Math.min(Math.ceil(seconds), MAX_RETRY_AFTER_SECONDS);
  }

  // HTTP-date form
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) {
    const deltaSeconds = Math.ceil((date - Date.now()) / 1000);
    return Math.max(0, Math.min(deltaSeconds, MAX_RETRY_AFTER_SECONDS));
  }

  return undefined;
}

function abortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

/**
 * Abortable sleep. When `signal` fires, the pending timer is cleared and the
 * promise rejects with an AbortError so retry/backoff waits unwind promptly
 * instead of blocking until the timer expires (R2-004).
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    let timeoutId: NodeJS.Timeout | undefined;
    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
  });
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

export type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  retries?: number;
  showSpinner?: boolean;
  spinnerText?: string;
  timeoutMs?: number;
  additionalHeaders?: Record<string, string>;
  authenticated?: boolean;
  onHeaders?: (headers: Headers) => void;
  /**
   * External cancellation signal (e.g. a foreground turn abort). Composed with
   * the per-attempt idle/timeout controller so an abort also terminates the
   * in-flight fetch, not just the response reader (VCL-002). An external abort
   * propagates as an AbortError and is never retried or misreported as a
   * timeout.
   */
  signal?: AbortSignal;
  /**
   * HTTP statuses that are parsed as a normal JSON body instead of throwing
   * (e.g. the x402 top-up probe expects a 402 with payment requirements).
   * Only meaningful for JSON responses; binary paths always throw.
   */
  allowedStatuses?: number[];
} & (
  | {
      responseType?: 'json';
      stream?: boolean;
      maxResponseBytes?: never;
      responseLabel?: never;
      expectedContentType?: never;
    }
  | {
      responseType: 'arrayBuffer';
      stream?: false;
      maxResponseBytes: number;
      responseLabel: string;
      expectedContentType: 'image';
    }
);

class BinaryResponseValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BinaryResponseValidationError';
  }
}

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
      await response.body?.cancel().catch(() => undefined);
      throw new BinaryResponseValidationError(
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
        await reader.cancel().catch(() => undefined);
        throw new BinaryResponseValidationError(
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

export async function apiRequest<T>(
  endpoint: string,
  options: ApiRequestOptions = {}
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
    onHeaders,
    authenticated = true,
    signal,
  } = options;

  const binaryOptions = options.responseType === 'arrayBuffer' ? options : undefined;
  if (binaryOptions && stream) {
    throw new BinaryResponseValidationError(
      'Binary responses cannot be returned as an unvalidated stream.'
    );
  }
  if (
    binaryOptions &&
    (!Number.isSafeInteger(binaryOptions.maxResponseBytes) || binaryOptions.maxResponseBytes <= 0)
  ) {
    throw new BinaryResponseValidationError(
      'Binary responses require a positive, finite byte limit.'
    );
  }

  let spinner = showSpinner && !stream ? startSpinner(spinnerText) : null;
  let lastError: VeniceApiError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    // Compose the external cancellation signal with the per-attempt timeout
    // controller so an aborted turn also terminates the in-flight request
    // during the header phase (VCL-002). If the parent is already aborted
    // (e.g. between retries), never start a fresh attempt against it (R2-004).
    const onExternalAbort = () => controller.abort();
    signal?.addEventListener('abort', onExternalAbort);
    if (signal?.aborted) controller.abort();

    try {
      const response = await fetch(`${VENICE_API}${endpoint}`, {
        method,
        headers: { ...getHeaders(authenticated), ...additionalHeaders },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok && !(options.allowedStatuses?.includes(response.status))) {
        let errorBody: string;
        if (binaryOptions) {
          const errorBytes = await readResponseBodyWithLimit(
            response,
            binaryOptions.maxResponseBytes,
            `${binaryOptions.responseLabel} API error response`
          );
          errorBody = errorBytes.toString('utf-8');
        } else {
          // VC-AUD-037: Bounded error reader
          const errorBytes = await readResponseBodyWithLimit(
            response,
            1024 * 1024, // 1MB max for error bodies
            'API error response'
          );
          clearTimeout(timeoutId);
          errorBody = errorBytes.toString('utf-8');
        }
        throw VeniceApiError.fromResponse(response, errorBody);
      }

      onHeaders?.(response.headers);

      if (stream) {
        clearTimeout(timeoutId);
        if (spinner) {
          stopSpinner(true);
          spinner = null;
        }
        return response as unknown as T;
      }

      if (binaryOptions) {
        const bytes = await readResponseBodyWithLimit(
          response,
          binaryOptions.maxResponseBytes,
          binaryOptions.responseLabel
        );
        if (bytes.length === 0) {
          throw new BinaryResponseValidationError(
            `${binaryOptions.responseLabel} response was empty.`
          );
        }

        const contentType = response.headers.get('content-type');
        if (binaryOptions.expectedContentType === 'image' && !isImageContentType(contentType)) {
          throw new BinaryResponseValidationError(
            `${binaryOptions.responseLabel} did not return an image Content-Type ` +
            `(received: ${contentType || 'missing'}).`
          );
        }
        if (binaryOptions.expectedContentType === 'image' && !looksLikeImageBytes(bytes)) {
          throw new BinaryResponseValidationError(
            `${binaryOptions.responseLabel} did not contain a supported PNG, JPEG, or WebP image.`
          );
        }

        clearTimeout(timeoutId);
        if (spinner) {
          stopSpinner(true);
          spinner = null;
        }
        return Uint8Array.from(bytes).buffer as T;
      }

      // VC-AUD-037: Bounded JSON reader
      const jsonBytes = await readResponseBodyWithLimit(
        response,
        50 * 1024 * 1024, // 50MB max for JSON
        'API JSON response'
      );
      clearTimeout(timeoutId);
      if (spinner) {
        stopSpinner(true);
        spinner = null;
      }
      return JSON.parse(jsonBytes.toString('utf-8')) as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        // A foreground turn abort must propagate immediately and never be
        // retried or misreported as an idle timeout (VCL-002).
        if (signal?.aborted) {
          throw error;
        }
        if (spinner) stopSpinner(false, 'Request timed out');
        throw new Error(
          `Request timed out after ${timeoutMs / 1000} seconds.\n` +
          'The server may be overloaded. Please try again later.'
        );
      }

      if (error instanceof BinaryResponseValidationError) {
        if (spinner) stopSpinner(false);
        throw error;
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

        // VC-AUD-038: Network Jitter + Retry-After backoff logic
        const jitter = Math.random() * 200; // up to 200ms jitter
        const backoff = (RETRY_DELAY_MS * Math.pow(2, attempt)) + jitter;

        // VC-KIMI-032: the final attempt must not sleep before failing.
        if (error.isRateLimited() && attempt < retries) {
          const waitTime = error.retryAfter ? (error.retryAfter * 1000) + jitter : backoff;
          if (spinner) spinner.text = `Rate limited, waiting... (attempt ${attempt + 1}/${retries + 1})`;
          await sleep(waitTime, signal);
          if (signal?.aborted) throw abortError();
          continue;
        }

        if (error.isRetryable() && attempt < retries) {
          if (spinner) spinner.text = `Retrying... (attempt ${attempt + 2}/${retries + 1})`;
          await sleep(backoff, signal);
          if (signal?.aborted) throw abortError();
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
          const jitter = Math.random() * 200;
          const backoff = (RETRY_DELAY_MS * Math.pow(2, attempt)) + jitter;
          await sleep(backoff, signal);
          if (signal?.aborted) throw abortError();
          continue;
        }
        lastError = new VeniceApiError(error.message);
      }

      if (spinner) stopSpinner(false);
      throw lastError || error;
    } finally {
      signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  if (spinner) stopSpinner(false);
  throw lastError || new Error('Request failed after retries');
}

/**
 * Assemble complete SSE frames from a streaming response body.
 *
 * Yields each event's joined `data:` payload (multi-line `data:` lines are
 * joined with `\n`), CRLF-tolerant. Comments/heartbeats are skipped, the
 * unterminated tail is flushed on EOF, and the reader is cancelled when
 * `signal` fires. Idle timeouts and protocol-terminal detection are the
 * caller's concern — this only yields frames, it never judges them.
 */
export async function* readSseFrames(
  response: Response,
  signal?: AbortSignal,
  idleTimeoutMs = 30000
): AsyncGenerator<string, void, void> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const onAbort = () => {
    reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', onAbort);

  const decoder = new TextDecoder();
  let buffer = '';
  let frameData: string[] = [];

  try {
    while (true) {
      const { done, value } = await readWithTimeout(reader, idleTimeoutMs);
      if (done) {
        // Flush the tail: servers may omit the trailing blank line / newline.
        buffer += decoder.decode();
        if (buffer.trim()) {
          for (const rawLine of buffer.split('\n')) {
            let line = rawLine;
            if (line.endsWith('\r')) line = line.slice(0, -1);
            if (line.startsWith('data:')) frameData.push(line.slice(5).replace(/^ /, ''));
          }
          buffer = '';
        }
        if (frameData.length > 0) {
          const data = frameData.join('\n');
          frameData = [];
          yield data;
        }
        return;
      }

      buffer += decoder.decode(value, { stream: true });
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        let line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1); // CRLF framing

        if (line === '') {
          // Blank line terminates the current SSE event frame.
          if (frameData.length > 0) {
            const data = frameData.join('\n');
            frameData = [];
            yield data;
          }
          continue;
        }
        if (line.startsWith(':')) continue; // SSE comments/heartbeats
        if (line.startsWith('data:')) {
          frameData.push(line.slice(5).replace(/^ /, ''));
        }
        // Other SSE fields (event:, id:, retry:) are ignored.
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.cancel().catch(() => {});
  }
}

function readWithTimeout(reader: ReadableStreamDefaultReader<Uint8Array>, ms: number): Promise<any> {
  let timeoutId: NodeJS.Timeout | undefined;
  return new Promise<any>((resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Stream idle timeout: server stopped sending data')), ms);
    reader.read().then(resolve).catch(reject);
  }).finally(() => clearTimeout(timeoutId));
}

/** Bounded body reader shared with endpoint adapters (media, document parse). */
export { readResponseBodyWithLimit };
