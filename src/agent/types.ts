/**
 * Shared types for the Venice CLI agent runtime.
 */

import type { MessageContent } from '../types/index.js';
import type { SkillSummary } from '../skills/types.js';

export type AgentStatus =
  | 'idle'
  | 'thinking'
  | 'awaiting_approval'
  | 'executing_tool'
  | 'verifying'
  | 'complete'
  | 'failed'
  | 'cancelled';

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: MessageContent;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface ToolInvocation {
  id: string;
  toolName: string;
  input: unknown;
  result: ToolResult<unknown>;
  approved: boolean;
  durationMs: number;
  timestamp: string;
}

export interface ValidationResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type SubagentKind = 'explore' | 'review' | 'research' | 'test' | 'general';

export interface SubagentFinding {
  severity?: string;
  file?: string;
  line?: number;
  description: string;
}

export interface SubagentResult {
  mode: 'read-only';
  kind: SubagentKind;
  task: string;
  status: AgentStatus;
  summary: string;
  findings: SubagentFinding[];
  recommendations: string[];
  filesInspected: string[];
}

export interface AgentState {
  sessionId: string;
  workspaceRoot: string;
  model: string;
  objective: string;
  status: AgentStatus;
  messages: AgentMessage[];
  todos: TodoItem[];
  relevantFiles: string[];
  changedFiles: string[];
  toolHistory: ToolInvocation[];
  tokenUsage?: TokenUsage;
  contextSummary?: StructuredSummary;
  checkpointIndex?: number;
  checkpointCount?: number;
  canUndoCheckpoints?: boolean;
  canRedoCheckpoints?: boolean;
  skillSummaries: SkillSummary[];
  activeSkills: string[];
  subagentReports?: SubagentResult[];
  lastValidation?: {
    commands: ValidationResult[];
    overallSuccess: boolean;
    timestamp: string;
  };
}

export interface StructuredSummary {
  objective: string;
  completedWork: string[];
  remainingWork: string[];
  decisions: string[];
  discoveries: string[];
  filesRead: string[];
  filesChanged: string[];
  commandsRun: { command: string; result: string }[];
  failures: string[];
  importantConstraints: string[];
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: ToolResultError;
  metadata?: {
    durationMs?: number;
    truncated?: boolean;
    affectedFiles?: string[];
  };
}

export interface ToolResultError {
  code: string;
  message: string;
  details?: unknown;
}

