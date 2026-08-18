/**
 * git_diff tool — show Git diff for the working tree.
 */

import { spawnSync } from 'node:child_process';
import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';
import { WorkspaceManager } from '../../agent/workspace.js';

export const gitDiffTool: AgentTool<{ cwd?: string; path?: string }, string> = {
  name: 'git_diff',
  description: 'Inspect uncommitted Git changes in the current workspace. Use when reviewing or summarizing what changed.',
  inputSchema: {
    type: 'object',
    properties: {
      cwd: { type: 'string', description: 'Working directory (defaults to workspace root)' },
      path: { type: 'string', description: 'Specific path to diff' },
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
      const args = ['--literal-pathspecs', 'diff'];
      if (input.path) {
        // `--` prevents option injection, while --literal-pathspecs prevents
        // user/LLM-supplied pathspec magic from changing Git semantics.
        args.push('--', input.path);
      }

      const result = spawnSync('git', args, { cwd, encoding: 'utf-8' });

      if (result.error) {
        return failure('GIT_DIFF_ERROR', result.error.message);
      }
      if (result.status !== 0) {
        return failure(
          'GIT_DIFF_ERROR',
          result.stderr.trim() || `git diff exited with status ${result.status ?? 'unknown'}`
        );
      }

      return success(result.stdout, { truncated: result.stdout.length > 50000 });
    } catch (error) {
      return failure('GIT_DIFF_ERROR', error instanceof Error ? error.message : String(error));
    }
  },
};
