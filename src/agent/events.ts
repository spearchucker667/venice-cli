/**
 * Append-only event bus for the agent runtime.
 */

import type { RuntimeModeState } from './mode.js';

export type AgentEvent =
  | { type: 'session_started'; timestamp: string; eventId: string; sessionId: string; objective: string }
  | { type: 'user_message'; timestamp: string; eventId: string; content: string }
  | { type: 'message_queued'; timestamp: string; eventId: string; content: string; queueLength: number }
  | { type: 'message_queued_consumed'; timestamp: string; eventId: string; content: string; remaining: number }
  | { type: 'message_injected'; timestamp: string; eventId: string; content: string }
  | { type: 'model_request'; timestamp: string; eventId: string; messageCount: number }
  | { type: 'model_profile_updated'; timestamp: string; eventId: string; profile: import('./model-profile.js').ModelProfile }
  | { type: 'assistant_delta'; timestamp: string; eventId: string; content?: string; toolCalls?: unknown[] }
  | { type: 'tool_requested'; timestamp: string; eventId: string; toolName: string; input: unknown }
  | { type: 'approval_requested'; timestamp: string; eventId: string; toolName: string; risk: string }
  | { type: 'approval_granted'; timestamp: string; eventId: string; toolName: string; scope: string }
  | { type: 'tool_started'; timestamp: string; eventId: string; toolCallId?: string; toolName: string; input: unknown }
  | { type: 'tool_completed'; timestamp: string; eventId: string; toolCallId?: string; toolName: string; input?: unknown; result: unknown }
  | { type: 'subagent_started'; timestamp: string; eventId: string; kind: string; mode: string; task: string; maxTurns: number }
  | { type: 'subagent_completed'; timestamp: string; eventId: string; kind: string; mode: string; status: string; findings: number; filesInspected: number; changedFiles: number }
  | { type: 'file_changed'; timestamp: string; eventId: string; path: string; operation: string }
  | { type: 'validation_started'; timestamp: string; eventId: string; command: string }
  | { type: 'validation_completed'; timestamp: string; eventId: string; command: string; exitCode: number; stdout?: string; stderr?: string }
  | { type: 'context_compacted'; timestamp: string; eventId: string; summary: unknown }
  | { type: 'mcp_ready'; timestamp: string; eventId: string; servers: Array<{ name: string; toolCount: number; error?: string }> }
  | { type: 'mcp_failed'; timestamp: string; eventId: string; message: string }
  | { type: 'mode_changed'; timestamp: string; eventId: string; mode: RuntimeModeState }
  | { type: 'title_changed'; timestamp: string; eventId: string; title: string }
  | { type: 'session_forked'; timestamp: string; eventId: string; parentSessionId: string; newSessionId: string }
  | { type: 'session_completed'; timestamp: string; eventId: string; status: string }
  | { type: 'session_persist_failed'; timestamp: string; eventId: string; message: string }
  | { type: 'plan_updated'; timestamp: string; eventId: string; plan: import('./types.js').PlanArtifact }
  | { type: 'plan_cleared'; timestamp: string; eventId: string }
  | { type: 'plan_exit_requested'; timestamp: string; eventId: string; plan: import('./types.js').PlanArtifact }
  | { type: 'plan_exit_approved'; timestamp: string; eventId: string }
  | { type: 'plan_exit_denied'; timestamp: string; eventId: string }
  | { type: 'user_question_requested'; timestamp: string; eventId: string; request: import('./types.js').UserQuestionRequest };

export class EventBus {
  private listeners: Array<(event: AgentEvent) => void> = [];
  public readonly events: AgentEvent[] = [];

  emit(event: AgentEvent): void {
    this.events.push(event);
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  on(listener: (event: AgentEvent) => void): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index !== -1) this.listeners.splice(index, 1);
    };
  }
}
