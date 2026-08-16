/**
 * Shared types for the Venice agent TUI.
 */

import type { AgentStatus } from '../agent/types.js';

export interface TuiMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool' | 'event';
  content: string;
  metadata?: Record<string, unknown>;
}

export interface TuiState {
  messages: TuiMessage[];
  status: AgentStatus;
  model: string;
  workspaceRoot: string;
  approvalMode: string;
  contextTokens: number;
  maxTokens: number;
  gitBranch?: string;
}
