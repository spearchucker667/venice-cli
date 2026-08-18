/**
 * find tool — find files by name pattern inside the workspace.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';
import { WorkspaceManager, toWorkspacePath } from '../../agent/workspace.js';

const MAX_FIND_RESULTS = 500;

function globToRegex(pattern: string): RegExp {
  let source = '^';
  for (const char of pattern) {
    if (char === '*') {
      source += '.*';
    } else if (char === '?') {
      source += '.';
    } else {
      source += char.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
    }
  }
  source += '$';
  return new RegExp(source);
}

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
    try {
      const workspace = new WorkspaceManager(
        context.workspaceRoot,
        context.workspace?.additionalRoots ?? []
      );
      const results: string[] = [];
      const regex = input.pattern ? globToRegex(input.pattern) : null;

      function walk(current: string, baseRoot: string): void {
        if (results.length > MAX_FIND_RESULTS) return;
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          if (results.length > MAX_FIND_RESULTS) break;
          const absolute = path.join(current, entry.name);
          const display = baseRoot === workspace.workspaceRoot
            ? toWorkspacePath(path.relative(baseRoot, absolute))
            : toWorkspacePath(absolute);
          if (entry.name.startsWith('.') && entry.isDirectory()) continue;
          if (entry.name === 'node_modules' || entry.name === 'dist') continue;
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) {
            walk(absolute, baseRoot);
          } else if (entry.isFile() && (!regex || regex.test(entry.name))) {
            results.push(display);
          }
        }
      }

      if (input.path) {
        const { absolute, root } = workspace.resolve(input.path);
        const stat = fs.statSync(absolute);
        if (stat.isDirectory()) {
          walk(absolute, root);
        } else if (stat.isFile()) {
          const display = root === workspace.workspaceRoot
            ? toWorkspacePath(path.relative(root, absolute))
            : toWorkspacePath(absolute);
          if (!regex || regex.test(path.basename(absolute))) results.push(display);
        }
      } else {
        for (const root of workspace.roots) {
          walk(root, root);
          if (results.length > MAX_FIND_RESULTS) break;
        }
      }
      const isTruncated = results.length > MAX_FIND_RESULTS;
      const capped = isTruncated ? results.slice(0, MAX_FIND_RESULTS) : results;
      return success(capped, { truncated: isTruncated, inspectedFiles: capped });
    } catch (error) {
      return failure('FIND_ERROR', error instanceof Error ? error.message : String(error));
    }
  },
};
