/**
 * Shared types for the Venice CLI agent runtime.
 */

import type { MessageContent } from '../types/index.js';
import type { SkillSummary } from '../skills/types.js';
import type { AgentMode, ModelProfile } from './model-profile.js';
import type { RuntimeModeState } from './mode.js';

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
  /** Origin of the invocation (e.g. `shell-mode`) for direct tool calls (VC-KIMI-054). */
  source?: string;
}

export interface ValidationResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type SubagentKind = 'explore' | 'review' | 'research' | 'test' | 'general';
export type SubagentMode = 'read-only' | 'write';

export interface SubagentFinding {
  severity?: string;
  file?: string;
  line?: number;
  description: string;
}

export interface SubagentResult {
  mode: SubagentMode;
  kind: SubagentKind;
  task: string;
  status: AgentStatus;
  summary: string;
  findings: SubagentFinding[];
  recommendations: string[];
  filesInspected: string[];
  changedFiles?: string[];
}

export interface PlanStep {
  id: string;
  text: string;
}

export interface PlanArtifact {
  summary: string;
  steps: PlanStep[];
  /** Absolute path of the plan file (defaults to <workspace>/PLAN.md). */
  filePath: string;
  updatedAt: string;
}

/** A single structured question asked of the user (VC-KIMI-058). */
export interface UserQuestion {
  prompt: string;
  options?: string[];
  multiSelect?: boolean;
}

/** A runtime interaction request emitted when a tool needs real user input. */
export interface UserQuestionRequest {
  id: string;
  questions: UserQuestion[];
}

/** The collected answers, one entry per question (multi-select joined). */
export interface UserQuestionResponse {
  id: string;
  answers: string[];
}

export interface AgentState {
  sessionId: string;
  workspaceRoot: string;
  workspace: {
    primaryRoot: string;
    additionalRoots: string[];
  };
  model: string;
  agentMode?: AgentMode;
  modelProfile?: ModelProfile;
  objective: string;
  status: AgentStatus;
  mode: RuntimeModeState;
  title?: string;
  parentSessionId?: string;
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
  /** Current plan artifact (plan mode). Persisted with the session. */
  plan?: PlanArtifact;
  lastValidation?: {
    commands: ValidationResult[];
    overallSuccess: boolean;
    timestamp: string;
  };
}

export interface StructuredSummary {
  objective: string;
  /** Optional guidance supplied via `/compact <hint>` (VC-KIMI-049). */
  hint?: string;
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
