/**
 * glob tool — find files matching a glob pattern inside the workspace.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentTool } from '../types.js';
import { success } from '../result.js';
import { WorkspaceManager, toWorkspacePath } from '../../agent/workspace.js';

function globSync(root: string, pattern: string): string[] {
  const parts = pattern.split('/').filter(Boolean);
  const results: string[] = [];

  function walk(current: string, index: number): void {
    if (index >= parts.length) {
      results.push(toWorkspacePath(path.relative(root, current)));
      return;
    }
    const part = parts[index];
    if (part === '**') {
      walk(current, index + 1);
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          walk(path.join(current, entry.name), index);
        }
      }
    } else {
      const regex = new RegExp('^' + part.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (regex.test(entry.name)) {
          const next = path.join(current, entry.name);
          if (index === parts.length - 1) {
            results.push(toWorkspacePath(path.relative(root, next)));
          } else if (entry.isDirectory()) {
            walk(next, index + 1);
          }
        }
      }
    }
  }

  walk(root, 0);
  return [...new Set(results)].sort();
}

export const globTool: AgentTool<{ pattern: string }, string[]> = {
  name: 'glob',
  description: 'Find files matching a glob pattern inside the workspace.',
  inputSchema: {
    type: 'object',
    properties: { pattern: { type: 'string' } },
    required: ['pattern'],
  },
  risk: 'read',
  async execute(input, context) {
    const workspace = new WorkspaceManager(context.workspaceRoot);
    try {
      const results = globSync(workspace.workspaceRoot, input.pattern);
      return success(results);
    } catch (error) {
      return { ok: false, error: { code: 'GLOB_ERROR', message: error instanceof Error ? error.message : String(error) } };
    }
  },
};
