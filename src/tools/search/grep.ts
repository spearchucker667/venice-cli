/**
 * grep tool — search file contents with a regular expression.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';
import { WorkspaceManager, toWorkspacePath } from '../../agent/workspace.js';

export const grepTool: AgentTool<{ pattern: string; paths?: string[] }, Array<{ file: string; line: number; text: string }>> = {
  name: 'grep',
  description: 'Search file contents with a regular expression.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern' },
      paths: { type: 'array', items: { type: 'string' }, description: 'Files or directories to search' },
    },
    required: ['pattern'],
  },
  risk: 'read',
  async execute(input, context) {
    const workspace = new WorkspaceManager(context.workspaceRoot, context.workspace?.additionalRoots ?? []);
    let regex: RegExp;
    try {
      regex = new RegExp(input.pattern, 'g');
    } catch (error) {
      return failure('INVALID_PATTERN', error instanceof Error ? error.message : String(error));
    }

    const results: Array<{ file: string; line: number; text: string }> = [];
    const searchRoots = input.paths?.length ? input.paths : workspace.roots;

    function searchFile(absolute: string, relative: string): void {
      if (workspace.isBinaryFile(absolute)) return;
      const content = fs.readFileSync(absolute, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          results.push({ file: relative, line: i + 1, text: lines[i].trim() });
        }
        regex.lastIndex = 0;
      }
    }

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
        } else {
          searchFile(absolute, display);
        }
      }
    }

    try {
      for (const root of searchRoots) {
        const resolved = workspace.resolve(root);
        const stat = fs.statSync(resolved.absolute);
        if (stat.isDirectory()) {
          walk(resolved.absolute, resolved.root);
        } else {
          const display = resolved.root === workspace.workspaceRoot
            ? resolved.relative
            : toWorkspacePath(resolved.absolute);
          searchFile(resolved.absolute, display);
        }
      }
      return success(results, { truncated: results.length > 100 });
    } catch (error) {
      return failure('GREP_ERROR', error instanceof Error ? error.message : String(error));
    }
  },
};
