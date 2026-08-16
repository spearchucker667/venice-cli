/**
 * git_diff tool — show Git diff for the working tree.
 */

import { spawnSync } from 'node:child_process';
import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';

export const gitDiffTool: AgentTool<{ cwd?: string; path?: string }, string> = {
  name: 'git_diff',
  description: 'Show Git diff for the working tree or a specific path.',
  inputSchema: {
    type: 'object',
    properties: {
      cwd: { type: 'string', description: 'Working directory (defaults to workspace root)' },
      path: { type: 'string', description: 'Specific path to diff' },
    },
  },
  risk: 'read',
  async execute(input, context) {
    const cwd = input.cwd ?? context.workspaceRoot;
    const args = ['diff'];
    if (input.path) args.push(input.path);

    const result = spawnSync('git', args, { cwd, encoding: 'utf-8' });

    if (result.error) {
      return failure('GIT_DIFF_ERROR', result.error.message);
    }

    return success(result.stdout, { truncated: result.stdout.length > 50000 });
  },
};
