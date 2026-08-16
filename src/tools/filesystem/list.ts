/**
 * list_directory tool — list entries in a workspace directory.
 */

import * as fs from 'node:fs';
import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';
import { WorkspaceManager } from '../../agent/workspace.js';

export const listDirectoryTool: AgentTool<{ path?: string }, string[]> = {
  name: 'list_directory',
  description: 'List entries in a workspace directory.',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string' } },
  },
  risk: 'read',
  async execute(input, context) {
    const workspace = new WorkspaceManager(context.workspaceRoot, context.workspace?.additionalRoots ?? []);
    try {
      const { absolute } = workspace.resolve(input.path || '.');
      const entries = fs.readdirSync(absolute, { withFileTypes: true });
      return success(entries.map((e) => `${e.isDirectory() ? 'd' : 'f'} ${e.name}`));
    } catch (error) {
      return failure('LIST_ERROR', error instanceof Error ? error.message : String(error));
    }
  },
};
