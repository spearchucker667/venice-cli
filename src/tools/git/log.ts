/**
 * git_log tool — show recent Git commit history.
 */

import { spawnSync } from 'node:child_process';
import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';
import { WorkspaceManager } from '../../agent/workspace.js';

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
    try {
      const workspace = new WorkspaceManager(
        context.workspaceRoot,
        context.workspace?.additionalRoots ?? []
      );
      const cwd = input.cwd ? workspace.resolve(input.cwd).absolute : workspace.workspaceRoot;
      const limit = input.limit ?? 10;
      const args = ['--literal-pathspecs', 'log', `--max-count=${limit}`, '--oneline'];
      if (input.path) {
        args.push('--', input.path);
      }

      const result = spawnSync('git', args, { cwd, encoding: 'utf-8' });

      if (result.error) {
        return failure('GIT_LOG_ERROR', result.error.message);
      }
      if (result.status !== 0) {
        return failure(
          'GIT_LOG_ERROR',
          result.stderr.trim() || `git log exited with status ${result.status ?? 'unknown'}`
        );
      }

      return success(result.stdout, { truncated: result.stdout.length > 50000 });
    } catch (error) {
      return failure('GIT_LOG_ERROR', error instanceof Error ? error.message : String(error));
    }
  },
};
