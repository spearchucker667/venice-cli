/**
 * Versioned JSONL event protocol for noninteractive agent output (VCL-R3-011).
 *
 * Every emitted line is a self-describing envelope:
 *
 * ```ts
 * interface AgentProtocolEvent<T> {
 *   schemaVersion: 2;
 *   sequence: number;
 *   eventId: string;
 *   sessionId: string;
 *   turnId?: string;
 *   timestamp: string;
 *   type: string;   // dotted, e.g. "tool.completed"
 *   data: T;        // event-specific payload
 * }
 * ```
 *
 * This is the shared substrate for stream-json output (and future ACP/web
 * transports): consumers can rely on the envelope fields for ordering,
 * correlation, and routing without knowing every event type in advance.
 */

import type { AgentEvent } from './events.js';

/**
 * Monotonic protocol revision. Bump on any breaking envelope change.
 *
 * v3 (R2-011): `turnId` now reflects the event's own turn (not a static
 * context value), `assistant.completed`/`assistant.error` are mapped instead
 * of dropped, tool lifecycle records carry the stable `toolCallId`, and a
 * single authoritative `run.result` terminal record is emitted.
 */
export const PROTOCOL_SCHEMA_VERSION = 3;

export interface AgentProtocolEvent<T = unknown> {
  schemaVersion: typeof PROTOCOL_SCHEMA_VERSION;
  sequence: number;
  eventId: string;
  sessionId: string;
  turnId?: string;
  timestamp: string;
  type: string;
  data: T;
}

/** Per-run correlation state supplied by the renderer. */
export interface StreamJsonContext {
  sessionId: string;
  sequence: number;
  turnId?: string;
}

export function toStreamJson(
  event: AgentEvent,
  ctx: StreamJsonContext
): AgentProtocolEvent | undefined {
  const base: {
    schemaVersion: typeof PROTOCOL_SCHEMA_VERSION;
    sequence: number;
    eventId: string;
    sessionId: string;
    turnId?: string;
    timestamp: string;
  } = {
    schemaVersion: PROTOCOL_SCHEMA_VERSION,
    sequence: ctx.sequence,
    eventId: event.eventId,
    sessionId: ctx.sessionId,
    // R2-011: prefer the event's own turn id so every record correlates to the
    // real turn; the context value is only a fallback for events without one.
    turnId: 'turnId' in event && event.turnId ? event.turnId : ctx.turnId,
    timestamp: event.timestamp,
  };

  switch (event.type) {
    case 'session_started':
      return { ...base, type: 'session.started', data: { objective: event.objective } };
    case 'session_completed':
      return { ...base, type: 'session.completed', data: { status: event.status } };
    case 'session_persist_failed':
      return { ...base, type: 'session.persist_failed', data: { message: event.message } };
    case 'session_forked':
      return {
        ...base,
        type: 'session.forked',
        data: { parentSessionId: event.parentSessionId, newSessionId: event.newSessionId },
      };
    case 'title_changed':
      return { ...base, type: 'session.title_changed', data: { title: event.title } };
    case 'user_message':
      return { ...base, type: 'user.message', data: { content: event.content } };
    case 'message_queued':
      return {
        ...base,
        type: 'message.queued',
        data: { content: event.content, queueLength: event.queueLength },
      };
    case 'message_queued_consumed':
      return {
        ...base,
        type: 'message.queued_consumed',
        data: { content: event.content, remaining: event.remaining },
      };
    case 'message_injected':
      return { ...base, type: 'message.injected', data: { content: event.content } };
    case 'model_request':
      return { ...base, type: 'model.request', data: { messageCount: event.messageCount } };
    case 'model_profile_updated':
      return { ...base, type: 'model.profile_updated', data: { profile: event.profile } };
    case 'model_catalog_failed':
      return { ...base, type: 'model.catalog_failed', data: { message: event.message } };
    case 'balance_remaining':
      return {
        ...base,
        type: 'balance.remaining',
        data: { balanceUsd: event.balanceUsd, rateLimit: event.rateLimit },
      };
    case 'assistant_delta':
      return { ...base, type: 'assistant.message', data: { content: event.content } };
    case 'assistant_reasoning':
      return { ...base, type: 'assistant.reasoning', data: { content: event.content } };
    case 'assistant_complete':
      return { ...base, type: 'assistant.completed', data: { content: event.content } };
    case 'assistant_error':
      return {
        ...base,
        type: 'assistant.error',
        data: { message: event.message, ...(event.code ? { code: event.code } : {}) },
      };
    case 'auth_fallback_used':
      return { ...base, type: 'auth.fallback_used', data: { kind: event.kind } };
    case 'tool_requested':
      return {
        ...base,
        type: 'tool.requested',
        data: { tool: event.toolName, input: event.input, ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}) },
      };
    case 'tool_started':
      return {
        ...base,
        type: 'tool.started',
        data: { tool: event.toolName, input: event.input, ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}) },
      };
    case 'tool_completed':
      return {
        ...base,
        type: 'tool.completed',
        data: { tool: event.toolName, result: event.result, ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}) },
      };
    case 'approval_requested':
      return { ...base, type: 'approval.requested', data: { tool: event.toolName, risk: event.risk } };
    case 'approval_granted':
      return { ...base, type: 'approval.granted', data: { tool: event.toolName, scope: event.scope } };
    case 'subagent_started':
      return {
        ...base,
        type: 'subagent.started',
        data: { kind: event.kind, mode: event.mode, task: event.task, maxTurns: event.maxTurns },
      };
    case 'subagent_completed':
      return {
        ...base,
        type: 'subagent.completed',
        data: {
          kind: event.kind,
          mode: event.mode,
          status: event.status,
          findings: event.findings,
          filesInspected: event.filesInspected,
          changedFiles: event.changedFiles,
        },
      };
    case 'file_changed':
      return {
        ...base,
        type: 'file.changed',
        data: { path: event.path, rootId: event.rootId, operation: event.operation },
      };
    case 'validation_started':
      return { ...base, type: 'validation.started', data: { command: event.command } };
    case 'validation_completed':
      return {
        ...base,
        type: 'validation.completed',
        data: { command: event.command, exitCode: event.exitCode, stdout: event.stdout, stderr: event.stderr },
      };
    case 'context_compacted':
      return { ...base, type: 'context.compacted', data: { summary: event.summary } };
    case 'mode_changed':
      return { ...base, type: 'mode.changed', data: { mode: event.mode } };
    case 'mcp_ready':
      return { ...base, type: 'mcp.ready', data: { servers: event.servers } };
    case 'mcp_failed':
      return { ...base, type: 'mcp.failed', data: { message: event.message } };
    case 'mcp_tools_changed':
      return { ...base, type: 'mcp.tools_changed', data: { serverName: event.serverName, toolCount: event.toolCount } };
    case 'plan_updated':
      return { ...base, type: 'plan.updated', data: { plan: event.plan } };
    case 'plan_cleared':
      return { ...base, type: 'plan.cleared', data: {} };
    case 'plan_exit_requested':
      return { ...base, type: 'plan.exit.requested', data: { plan: event.plan } };
    case 'plan_exit_approved':
      return { ...base, type: 'plan.exit.approved', data: {} };
    case 'plan_exit_denied':
      return { ...base, type: 'plan.exit.denied', data: {} };
    case 'user_question_requested':
      return { ...base, type: 'user.question_requested', data: { request: event.request } };
    default:
      return undefined;
  }
}

export function serializeStreamJson(event: AgentProtocolEvent): string {
  return JSON.stringify(event);
}

/** Authoritative terminal record carried by `run.result` (R2-011). */
export interface RunResultData {
  status: string;
  finalText?: string;
  incompleteReason?: string;
  error?: string;
}

/**
 * Build the single authoritative terminal record for a run. Consumers can
 * determine the outcome from this record alone: `completed`/`failed`/
 * `cancelled`/`limit_reached` status, the final assistant text, and an
 * explicit incomplete reason where applicable.
 */
export function buildTerminalResult(
  event: Extract<AgentEvent, { type: 'session_completed' }>,
  ctx: StreamJsonContext,
  finalText?: string
): AgentProtocolEvent {
  const data: RunResultData = { status: event.status };
  if (finalText) data.finalText = finalText;
  if (event.status === 'limit_reached') data.incompleteReason = 'max_turns';
  if (event.status === 'failed' || event.status === 'cancelled') data.error = event.status;
  return {
    schemaVersion: PROTOCOL_SCHEMA_VERSION,
    sequence: ctx.sequence,
    eventId: event.eventId,
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    timestamp: event.timestamp,
    type: 'run.result',
    data,
  };
}
