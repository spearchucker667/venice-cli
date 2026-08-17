/**
 * Normalized tool abstraction for the agent runtime.
 */

import type { ToolDefinition } from '../types/index.js';
import type { AgentState, ToolResult } from '../agent/types.js';
import type { CheckpointManager } from '../agent/checkpoints.js';
import type { SkillRegistry } from '../skills/registry.js';
import type { RiskLevel } from '../agent/permissions.js';
import type { ToolEffect } from '../agent/effects.js';

export interface ToolContext {
  workspaceRoot: string;
  /** Optional additional roots (Kimi-style --add-dir) for the path authority. */
  workspace?: { primaryRoot: string; additionalRoots: string[] };
  sessionId: string;
  objective: string;
  runtimeState: Readonly<AgentState>;
  signal?: AbortSignal;
  checkpointManager?: CheckpointManager;
  skillRegistry?: SkillRegistry;
}

export interface AgentTool<TInput = unknown, TOutput = unknown> {
  name: string;
  /** Optional human-friendly display title (e.g. an MCP tool title). */
  title?: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** Optional JSON Schema describing the tool's return value. */
  outputSchema?: unknown;
  /**
   * Untrusted metadata surfaced read-only (e.g. MCP tool annotations). It is
   * never used to make security or permission decisions (VCL-R3-021).
   */
  untrustedMetadata?: unknown;
  risk: RiskLevel | ((input: unknown) => RiskLevel);
  planSafe?: boolean;
  parallelSafe?: boolean;
  execute(input: TInput, context: ToolContext): Promise<ToolResult<TOutput>>;
  /**
   * Declarative reactions applied before `execute` (e.g. `subagentStarted`).
   * Defaults to no-op for tools with no pre-execution side effects.
   */
  startEffects?(input: TInput): ToolEffect[];
  /**
   * Declarative reactions applied after `execute`, derived only from the
   * tool's own result (plan, skill, todo, subagent-report, ask_user). Keeps
   * lifecycle locality in the tool module instead of the runtime's name switch.
   */
  effects?(result: ToolResult<TOutput>): ToolEffect[];
}

export function toToolDefinition(tool: AgentTool): ToolDefinition {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}
