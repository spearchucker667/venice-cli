/**
 * Map agent runtime events to TUI transcript messages.
 */

import type { AgentEvent } from '../agent/events.js';
import type { TuiMessage } from './types.js';

export function mapEventToMessage(event: AgentEvent): TuiMessage | undefined {
  switch (event.type) {
    case 'session_started':
      return { id: event.eventId, role: 'event', content: event.objective ? `▶ ${event.objective}` : 'Venice ready' };
    case 'model_profile_updated':
      return undefined;
    case 'model_request':
      return { id: event.eventId, role: 'event', content: 'thinking…' };
    case 'assistant_delta':
      return { id: event.eventId, role: 'assistant', content: event.content || '' };
    case 'tool_requested':
      return undefined;
    case 'tool_started':
      return {
        id: event.eventId,
        role: 'tool',
        content: 'running',
        metadata: { toolCallId: event.toolCallId, toolName: event.toolName, input: event.input, pending: true },
      };
    case 'tool_completed': {
      const result = event.result as { ok?: boolean; error?: { message?: string } };
      return {
        id: event.eventId,
        role: 'tool',
        content: result.ok ? 'done' : 'failed',
        metadata: {
          toolName: event.toolName,
          toolCallId: event.toolCallId,
          input: event.input,
          ok: result.ok,
          error: result.error?.message,
          result,
        },
      };
    }
    case 'subagent_started':
      return { id: event.eventId, role: 'event', content: `↳ ${event.mode} subagent ${event.kind}: ${event.task}` };
    case 'subagent_completed':
      return {
        id: event.eventId,
        role: 'event',
        content: `↳ ${event.mode} subagent ${event.status} (${event.findings} findings, ${event.filesInspected} inspected, ${event.changedFiles} changed)`,
      };
    case 'approval_requested':
      return { id: event.eventId, role: 'event', content: `? approval required: ${event.toolName}` };
    case 'file_changed':
      return { id: event.eventId, role: 'event', content: `~ ${event.path}` };
    case 'validation_started':
      return { id: event.eventId, role: 'event', content: `● Running ${event.command}` };
    case 'validation_completed':
      return { id: event.eventId, role: 'event', content: `${event.exitCode === 0 ? '✓' : '✗'} ${event.command} · exit ${event.exitCode}` };
    case 'context_compacted':
      return { id: event.eventId, role: 'event', content: '… context compacted' };
    case 'session_completed':
      return { id: event.eventId, role: 'event', content: `● ${event.status}` };
    case 'session_persist_failed':
      return { id: event.eventId, role: 'event', content: `⚠ Session save failed: ${event.message}` };
    case 'mcp_ready':
      return { id: event.eventId, role: 'event', content: `MCP ready: ${event.servers.map((s) => `${s.name} (${s.toolCount} tools)`).join(', ')}` };
    case 'mcp_failed':
      return { id: event.eventId, role: 'event', content: `MCP failed: ${event.message}` };
    case 'plan_updated':
      return { id: event.eventId, role: 'event', content: `📋 Plan updated: ${event.plan.summary || `${event.plan.steps.length} steps`}` };
    case 'plan_cleared':
      return { id: event.eventId, role: 'event', content: 'Plan cleared.' };
    case 'plan_exit_requested':
      return { id: event.eventId, role: 'event', content: '? Approve the plan to start executing?' };
    case 'plan_exit_approved':
      return { id: event.eventId, role: 'event', content: '✓ Plan approved. Executing.' };
    case 'plan_exit_denied':
      return { id: event.eventId, role: 'event', content: '✗ Plan not approved. Revise and try again.' };
    default:
      return undefined;
  }
}
