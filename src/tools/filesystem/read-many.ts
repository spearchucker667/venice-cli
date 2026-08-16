/**
 * read_many_files tool — read multiple text files at once.
 */

import * as fs from 'node:fs';
import type { AgentTool } from '../types.js';
import { success } from '../result.js';
import { WorkspaceManager } from '../../agent/workspace.js';

export const readManyFilesTool: AgentTool<{ paths: string[] }, Record<string, string>> = {
  name: 'read_many_files',
  description: 'Read multiple text files at once.',
  inputSchema: {
    type: 'object',
    properties: {
      paths: { type: 'array', items: { type: 'string' } },
    },
    required: ['paths'],
  },
  risk: 'read',
  async execute(input, context) {
    const workspace = new WorkspaceManager(context.workspaceRoot);
    const contents: Record<string, string> = {};
    for (const p of input.paths) {
      try {
        const { absolute, relative } = workspace.resolve(p);
        if (workspace.isBinaryFile(absolute)) {
          contents[relative] = '<binary file>';
          continue;
        }
        contents[relative] = fs.readFileSync(absolute, 'utf-8');
      } catch (error) {
        contents[p] = `Error: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    return success(contents);
  },
};
