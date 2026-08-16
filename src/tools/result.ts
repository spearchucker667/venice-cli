/**
 * Helpers for building normalized tool results.
 */

import type { ToolResult } from '../agent/types.js';

export function success<T>(data: T, metadata?: ToolResult<T>['metadata']): ToolResult<T> {
  return { ok: true, data, metadata };
}

export function failure<T>(
  code: string,
  message: string,
  details?: unknown,
  metadata?: ToolResult<T>['metadata']
): ToolResult<T> {
  return { ok: false, error: { code, message, details }, metadata };
}
