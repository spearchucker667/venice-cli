/**
 * read_file tool — read a text file inside the workspace.
 */

import * as fs from 'node:fs';
import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';
import { WorkspaceManager } from '../../agent/workspace.js';

export const readFileTool: AgentTool<{ path: string }, string> = {
  name: 'read_file',
  description: 'Read the contents of a text file inside the workspace.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path inside the workspace' },
    },
    required: ['path'],
  },
  risk: 'read',
  async execute(input, context) {
    const workspace = new WorkspaceManager(context.workspaceRoot);
    try {
      const { absolute, relative } = workspace.resolve(input.path);
      if (workspace.isBinaryFile(absolute)) {
        return failure('BINARY_FILE', `File is binary: ${relative}`);
      }
      const stats = fs.statSync(absolute);
      if (stats.size > 1024 * 1024) {
        return failure('FILE_TOO_LARGE', `File too large: ${relative}`);
      }
      const content = fs.readFileSync(absolute, 'utf-8');
      return success(content);
    } catch (error) {
      return failure('READ_ERROR', error instanceof Error ? error.message : String(error));
    }
  },
};
