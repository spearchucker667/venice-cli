/**
 * Versioned JSONL event protocol for noninteractive agent output.
 */

import type { AgentEvent } from './events.js';

export const STREAM_JSON_VERSION = '2026-08-16';

export interface StreamJsonEvent {
  type: string;
  schemaVersion: string;
  timestamp?: string;
  [key: string]: unknown;
}

export function toStreamJson(event: AgentEvent): StreamJsonEvent | undefined {
  switch (event.type) {
    case 'session_started':
      return {
        type: 'session.started',
        schemaVersion: STREAM_JSON_VERSION,
        timestamp: event.timestamp,
        sessionId: event.sessionId,
      };
    case 'assistant_delta':
      return {
        type: 'assistant.message',
        schemaVersion: STREAM_JSON_VERSION,
        timestamp: event.timestamp,
        content: event.content,
      };
    case 'tool_requested':
      return {
        type: 'tool.requested',
        schemaVersion: STREAM_JSON_VERSION,
        timestamp: event.timestamp,
        tool: event.toolName,
        input: event.input,
      };
    case 'tool_completed':
      return {
        type: 'tool.completed',
        schemaVersion: STREAM_JSON_VERSION,
        timestamp: event.timestamp,
        tool: event.toolName,
        result: event.result,
      };
    case 'session_completed':
      return {
        type: 'session.completed',
        schemaVersion: STREAM_JSON_VERSION,
        timestamp: event.timestamp,
        status: event.status,
      };
    default:
      return undefined;
  }
}

export function serializeStreamJson(event: StreamJsonEvent): string {
  return JSON.stringify(event);
}
