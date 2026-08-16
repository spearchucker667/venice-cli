/**
 * Map agent runtime events to TUI transcript messages.
 */

import type { AgentEvent } from '../agent/events.js';
import type { TuiMessage } from './types.js';

export function mapEventToMessage(event: AgentEvent): TuiMessage | undefined {
  switch (event.type) {
    case 'session_started':
      return { id: event.eventId, role: 'event', content: `▶ ${event.objective}` };
    case 'model_request':
      return { id: event.eventId, role: 'event', content: 'thinking…' };
    case 'assistant_delta':
      return { id: event.eventId, role: 'assistant', content: event.content || '' };
    case 'tool_requested':
      return { id: event.eventId, role: 'event', content: `• ${event.toolName}` };
    case 'tool_completed': {
      const result = event.result as { ok?: boolean; error?: { message?: string } };
      return {
        id: event.eventId,
        role: 'tool',
        content: result.ok ? 'done' : 'failed',
        metadata: {
          toolName: event.toolName,
          ok: result.ok,
          error: result.error?.message,
        },
      };
    }
    case 'subagent_started':
      return { id: event.eventId, role: 'event', content: `↳ subagent ${event.kind}: ${event.task}` };
    case 'subagent_completed':
      return {
        id: event.eventId,
        role: 'event',
        content: `↳ subagent ${event.status} (${event.findings} findings, ${event.filesInspected} files)`,
      };
    case 'approval_requested':
      return { id: event.eventId, role: 'event', content: `? approval required: ${event.toolName}` };
    case 'file_changed':
      return { id: event.eventId, role: 'event', content: `~ ${event.path}` };
    case 'context_compacted':
      return { id: event.eventId, role: 'event', content: '… context compacted' };
    case 'session_completed':
      return { id: event.eventId, role: 'event', content: `● ${event.status}` };
    case 'mcp_ready':
      return { id: event.eventId, role: 'event', content: `MCP ready: ${event.servers.map((s) => `${s.name} (${s.toolCount} tools)`).join(', ')}` };
    case 'mcp_failed':
      return { id: event.eventId, role: 'event', content: `MCP failed: ${event.message}` };
    default:
      return undefined;
  }
}
