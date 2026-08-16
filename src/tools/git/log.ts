/**
 * git_log tool — show recent Git commit history.
 */

import { spawnSync } from 'node:child_process';
import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';

export const gitLogTool: AgentTool<{ cwd?: string; limit?: number; path?: string }, string> = {
  name: 'git_log',
  description: 'Show recent Git commit history.',
  inputSchema: {
    type: 'object',
    properties: {
      cwd: { type: 'string', description: 'Working directory (defaults to workspace root)' },
      limit: { type: 'number', description: 'Maximum number of commits' },
      path: { type: 'string', description: 'Specific path to filter log' },
    },
  },
  risk: 'read',
  async execute(input, context) {
    const cwd = input.cwd ?? context.workspaceRoot;
    const limit = input.limit ?? 10;
    const args = ['log', `--max-count=${limit}`, '--oneline'];
    if (input.path) args.push(input.path);

    const result = spawnSync('git', args, { cwd, encoding: 'utf-8' });

    if (result.error) {
      return failure('GIT_LOG_ERROR', result.error.message);
    }

    return success(result.stdout, { truncated: result.stdout.length > 50000 });
  },
};
