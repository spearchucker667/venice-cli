/**
 * find tool — find files by name pattern inside the workspace.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';
import { WorkspaceManager, toWorkspacePath } from '../../agent/workspace.js';

export const findTool: AgentTool<{ pattern?: string; path?: string }, string[]> = {
  name: 'find',
  description: 'Find files by name pattern inside the workspace.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string' },
      path: { type: 'string' },
    },
  },
  risk: 'read',
  async execute(input, context) {
    const workspace = new WorkspaceManager(context.workspaceRoot, context.workspace?.additionalRoots ?? []);
    const results: string[] = [];
    const regex = input.pattern ? new RegExp('^' + input.pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$') : null;

    function walk(current: string, baseRoot: string): void {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const absolute = path.join(current, entry.name);
        const display = baseRoot === workspace.workspaceRoot
          ? toWorkspacePath(path.relative(baseRoot, absolute))
          : toWorkspacePath(absolute);
        if (entry.name.startsWith('.') && entry.isDirectory()) continue;
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;
        if (entry.isDirectory()) {
          walk(absolute, baseRoot);
        } else if (!regex || regex.test(entry.name)) {
          results.push(display);
        }
      }
    }

    try {
      if (input.path) {
        const { absolute, root } = workspace.resolve(input.path);
        walk(absolute, root);
      } else {
        for (const root of workspace.roots) {
          walk(root, root);
        }
      }
      return success(results);
    } catch (error) {
      return failure('FIND_ERROR', error instanceof Error ? error.message : String(error));
    }
  },
};
