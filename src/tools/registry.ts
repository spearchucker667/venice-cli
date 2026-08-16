/**
 * Unified registry for all agent tools.
 */

import type { AgentTool, ToolContext } from './types.js';
import { toToolDefinition } from './types.js';
import type { ToolDefinition } from '../types/index.js';
import type { ToolResult } from '../agent/types.js';
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
import { runValidationTool } from './validation/run.js';
import { webSearchTool, webScrapeTool } from './venice/search.js';
import { editImageTool, generateImageTool, removeBackgroundTool, upscaleImageTool } from './venice/image.js';
import { textToSpeechTool, transcribeAudioTool, generateMusicTool } from './venice/audio.js';
import { generateVideoTool, imageToVideoTool } from './venice/video.js';

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  definitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(toToolDefinition);
  }

  async execute(name: string, input: unknown, context: ToolContext): Promise<ToolResult<unknown>> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { ok: false, error: { code: 'TOOL_NOT_FOUND', message: `Unknown tool: ${name}` } };
    }
    return await tool.execute(input as never, context);
  }
}

export function createDefaultRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(readManyFilesTool);
  registry.register(writeFileTool);
  registry.register(editFileTool);
  registry.register(applyPatchTool);
  registry.register(listDirectoryTool);
  registry.register(globTool);
  registry.register(grepTool);
  registry.register(findTool);
  registry.register(shellTool);
  registry.register(gitStatusTool);
  registry.register(gitDiffTool);
  registry.register(gitLogTool);
  registry.register(todoReadTool);
  registry.register(todoWriteTool);
  registry.register(askUserTool);
  registry.register(checkpointListTool);
  registry.register(checkpointUndoTool);
  registry.register(checkpointRedoTool);
  registry.register(skillListTool);
  registry.register(skillLoadTool);
  registry.register(spawnAgentTool);
  registry.register(runValidationTool);
  registry.register(webSearchTool);
  registry.register(webScrapeTool);
  registry.register(generateImageTool);
  registry.register(editImageTool);
  registry.register(upscaleImageTool);
  registry.register(removeBackgroundTool);
  registry.register(generateVideoTool);
  registry.register(imageToVideoTool);
  registry.register(transcribeAudioTool);
  registry.register(textToSpeechTool);
  registry.register(generateMusicTool);
  return registry;
}
