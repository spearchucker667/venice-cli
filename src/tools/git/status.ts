/**
 * git_status tool — inspect the current Git working tree status.
 */

import { spawnSync } from 'node:child_process';
import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';
import { WorkspaceManager } from '../../agent/workspace.js';

export interface GitStatusEntry {
  status: string;
  file: string;
  original?: string;
}

export const gitStatusTool: AgentTool<{ cwd?: string }, { branch?: string; entries: GitStatusEntry[]; raw: string }> = {
  name: 'git_status',
  description: 'Inspect the current Git working tree status.',
  inputSchema: {
    type: 'object',
    properties: {
      cwd: { type: 'string', description: 'Working directory (defaults to workspace root)' },
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
      const result = spawnSync('git', ['status', '--porcelain', '-b'], { cwd, encoding: 'utf-8' });

      if (result.error) {
        return failure('GIT_STATUS_ERROR', result.error.message);
      }
      if (result.status !== 0) {
        return failure(
          'GIT_STATUS_ERROR',
          result.stderr.trim() || `git status exited with status ${result.status ?? 'unknown'}`
        );
      }

      const lines = result.stdout.split('\n');
      const branchLine = lines[0].startsWith('## ') ? lines[0].slice(3) : undefined;
      const entries: GitStatusEntry[] = [];

      for (const line of lines.slice(1)) {
        if (!line) continue;
        const status = line.slice(0, 2);
        const rest = line.slice(3);
        if (rest.includes(' -> ')) {
          const [original, file] = rest.split(' -> ');
          entries.push({ status, file, original });
        } else {
          entries.push({ status, file: rest });
        }
      }

      return success({ branch: branchLine, entries, raw: result.stdout });
    } catch (error) {
      return failure('GIT_STATUS_ERROR', error instanceof Error ? error.message : String(error));
    }
  },
};
