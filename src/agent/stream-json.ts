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

/** Monotonic protocol revision. Bump on any breaking envelope change. */
export const PROTOCOL_SCHEMA_VERSION = 2;

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
    turnId: ctx.turnId,
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
    case 'tool_requested':
      return { ...base, type: 'tool.requested', data: { tool: event.toolName, input: event.input } };
    case 'tool_started':
      return { ...base, type: 'tool.started', data: { tool: event.toolName, input: event.input } };
    case 'tool_completed':
      return { ...base, type: 'tool.completed', data: { tool: event.toolName, result: event.result } };
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
