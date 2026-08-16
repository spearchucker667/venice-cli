/**
 * Normalized tool abstraction for the agent runtime.
 */

import type { ToolDefinition } from '../types/index.js';
import type { AgentState, ToolResult } from '../agent/types.js';
import type { CheckpointManager } from '../agent/checkpoints.js';
import type { SkillRegistry } from '../skills/registry.js';
import type { RiskLevel } from '../agent/permissions.js';

export interface ToolContext {
  workspaceRoot: string;
  sessionId: string;
  objective: string;
  runtimeState: Readonly<AgentState>;
  signal?: AbortSignal;
  checkpointManager?: CheckpointManager;
  skillRegistry?: SkillRegistry;
}

export interface AgentTool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  risk: RiskLevel | ((input: unknown) => RiskLevel);
  execute(input: TInput, context: ToolContext): Promise<ToolResult<TOutput>>;
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
