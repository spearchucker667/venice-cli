/**
 * Unified registry for all agent tools.
 */

import type { AgentTool, ToolContext } from './types.js';
import { toToolDefinition } from './types.js';
import type { ToolDefinition } from '../types/index.js';
import type { ToolResult } from '../agent/types.js';
import { compileToolSchema, formatSchemaErrors } from '../lib/tool-schema.js';
import type { ValidateFunction } from 'ajv';
import { readFileTool } from './filesystem/read.js';
import { readManyFilesTool } from './filesystem/read-many.js';
import { writeFileTool } from './filesystem/write.js';
import { editFileTool } from './filesystem/edit.js';
import { applyPatchTool } from './filesystem/patch.js';
import { listDirectoryTool } from './filesystem/list.js';
import { globTool } from './filesystem/glob.js';
import { grepTool } from './search/grep.js';
import { findTool } from './search/find.js';
import { shellTool } from './shell/execute.js';
import { gitStatusTool } from './git/status.js';
import { gitDiffTool } from './git/diff.js';
import { gitLogTool } from './git/log.js';
import { todoReadTool } from './agent-meta/todo-read.js';
import { todoWriteTool } from './agent-meta/todo-write.js';
import { askUserTool } from './agent-meta/ask-user.js';
import { checkpointListTool } from './agent-meta/checkpoint-list.js';
import { checkpointUndoTool } from './agent-meta/checkpoint-undo.js';
import { checkpointRedoTool } from './agent-meta/checkpoint-redo.js';
import { skillListTool } from './agent-meta/skill-list.js';
import { skillLoadTool } from './agent-meta/skill-load.js';
import { spawnAgentTool } from './agent-meta/spawn-agent.js';
import { enterPlanModeTool, writePlanTool, exitPlanModeTool } from './agent-meta/plan.js';
import { runValidationTool } from './validation/run.js';
import { webSearchTool, webScrapeTool } from './venice/search.js';
import { editImageTool, generateImageTool, removeBackgroundTool, upscaleImageTool } from './venice/image.js';
import { textToSpeechTool, transcribeAudioTool, generateMusicTool } from './venice/audio.js';
import { generateVideoTool, imageToVideoTool } from './venice/video.js';

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();
  private readonly validators = new Map<string, ValidateFunction>();

  register(tool: AgentTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
    // Compile the schema up front so a malformed schema fails at registration
    // (VCL-R3-005). A tool whose schema cannot be compiled is not usable.
    this.validators.set(tool.name, compileToolSchema(tool.inputSchema));
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Remove every tool whose name starts with `prefix`, returning the removed
   * names. Used to atomically replace an MCP server's namespace on a
   * tools/list_changed notification (VCL-R3-014).
   */
  unregisterPrefix(prefix: string): string[] {
    const removed: string[] = [];
    for (const name of Array.from(this.tools.keys())) {
      if (name.startsWith(prefix)) {
        this.tools.delete(name);
        this.validators.delete(name);
        removed.push(name);
      }
    }
    return removed;
  }

  definitions(operatingMode?: 'agent' | 'plan'): ToolDefinition[] {
    // Plan mode uses explicit positive authorization: only tools marked
    // `planSafe: true` are exposed. An omitted flag is NOT treated as safe
    // (VC-KIMI-069), so a mutating tool that forgets its annotation cannot
    // leak into plan mode.
    const tools = operatingMode === 'plan'
      ? Array.from(this.tools.values()).filter((tool) => tool.planSafe === true)
      : Array.from(this.tools.values());
    return tools.map(toToolDefinition);
  }

  async execute(name: string, input: unknown, context: ToolContext): Promise<ToolResult<unknown>> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { ok: false, error: { code: 'TOOL_NOT_FOUND', message: `Unknown tool: ${name}` } };
    }
    return await tool.execute(input as never, context);
  }

  /**
   * Validate parsed tool arguments against the tool's advertised schema.
   * Returns a list of human-readable problems; empty means valid.
   */
  validateInput(name: string, input: unknown): string[] {
    const validate = this.validators.get(name);
    if (!validate) return [];
    if (validate(input)) return [];
    return formatSchemaErrors(validate.errors);
  }
}

export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  // Read-only tools are explicitly plan-safe; every mutating or external
  // tool is explicitly excluded from plan mode.
  // Read-only tools are explicitly plan-safe AND parallel-safe (VCL-R3-022):
  // they have no shared mutable state, so the runtime may run them
  // concurrently. Every mutating/external tool stays serial.
  registry.register({ ...readFileTool, planSafe: true, parallelSafe: true });
  registry.register({ ...readManyFilesTool, planSafe: true, parallelSafe: true });
  registry.register({ ...writeFileTool, planSafe: false });
  registry.register({ ...editFileTool, planSafe: false });
  registry.register({ ...applyPatchTool, planSafe: false });
  registry.register({ ...listDirectoryTool, planSafe: true, parallelSafe: true });
  registry.register({ ...globTool, planSafe: true, parallelSafe: true });
  registry.register({ ...grepTool, planSafe: true, parallelSafe: true });
  registry.register({ ...findTool, planSafe: true, parallelSafe: true });
  registry.register({ ...shellTool, planSafe: false });
  registry.register({ ...gitStatusTool, planSafe: true, parallelSafe: true });
  registry.register({ ...gitDiffTool, planSafe: true, parallelSafe: true });
  registry.register({ ...gitLogTool, planSafe: true, parallelSafe: true });
  registry.register({ ...todoReadTool, planSafe: true, parallelSafe: true });
  registry.register({ ...todoWriteTool, planSafe: false });
  registry.register({ ...askUserTool, planSafe: true });
  registry.register({ ...checkpointListTool, planSafe: true, parallelSafe: true });
  // Checkpoint undo/redo restore files and must not be usable as a loophole
  // around plan-mode restrictions (VC-KIMI-006).
  registry.register({ ...checkpointUndoTool, planSafe: false });
  registry.register({ ...checkpointRedoTool, planSafe: false });
  registry.register({ ...skillListTool, planSafe: true, parallelSafe: true });
  registry.register({ ...skillLoadTool, planSafe: true });
  registry.register({ ...spawnAgentTool, planSafe: false });
  // Plan-mode lifecycle tools: only the plan artifact may be written in plan
  // mode, and exiting with a plan requires explicit approval (work order §9).
  registry.register({ ...enterPlanModeTool, planSafe: true });
  registry.register({ ...writePlanTool, planSafe: true });
  registry.register({ ...exitPlanModeTool, planSafe: true });
  registry.register({ ...runValidationTool, planSafe: false });
  // Web reads are side-effect-free on the workspace and safe to parallelize.
  registry.register({ ...webSearchTool, planSafe: true, parallelSafe: true });
  registry.register({ ...webScrapeTool, planSafe: true, parallelSafe: true });
  registry.register({ ...generateImageTool, planSafe: false });
  registry.register({ ...editImageTool, planSafe: false });
  registry.register({ ...upscaleImageTool, planSafe: false });
  registry.register({ ...removeBackgroundTool, planSafe: false });
  registry.register({ ...generateVideoTool, planSafe: false });
  registry.register({ ...imageToVideoTool, planSafe: false });
  registry.register({ ...transcribeAudioTool, planSafe: false });
  registry.register({ ...textToSpeechTool, planSafe: false });
  registry.register({ ...generateMusicTool, planSafe: false });
  return registry;
}
