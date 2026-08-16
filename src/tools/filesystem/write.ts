/**
 * write_file tool — write content to a file inside the workspace.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';
import { WorkspaceManager } from '../../agent/workspace.js';

export const writeFileTool: AgentTool<{ path: string; content: string }, { bytesWritten: number }> = {
  name: 'write_file',
  description: 'Write content to a file inside the workspace.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
    },
    required: ['path', 'content'],
  },
  risk: 'write',
  async execute(input, context) {
    const workspace = new WorkspaceManager(context.workspaceRoot, context.workspace?.additionalRoots ?? []);
    try {
      const { absolute, relative, root } = workspace.resolve(input.path);
      const originalContent = fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf-8') : null;
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, input.content, 'utf-8');
      context.checkpointManager?.record({
        operation: 'write_file',
        relativePath: relative,
        originalContent,
        newContent: input.content,
      });
      workspace.markChangedResolved({ absolute, relative, root });
      return success({ bytesWritten: Buffer.byteLength(input.content, 'utf-8') }, { affectedFiles: [relative] });
    } catch (error) {
      return failure('WRITE_ERROR', error instanceof Error ? error.message : String(error));
    }
  },
};
