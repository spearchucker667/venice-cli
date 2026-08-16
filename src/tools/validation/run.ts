/**
 * run_validation tool — run a repository validation command and report results.
 */

import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';
import { shellTool } from '../shell/execute.js';
import { WorkspaceManager } from '../../agent/workspace.js';

export const runValidationTool: AgentTool<{ command: string; cwd?: string; timeoutMs?: number }, { exitCode: number; stdout: string; stderr: string }> = {
  name: 'run_validation',
  description: 'Run a repository validation command (test, build, lint, etc.) and report the result.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Validation command to run' },
      cwd: { type: 'string', description: 'Working directory relative to workspace root' },
      timeoutMs: { type: 'number', description: 'Timeout in milliseconds' },
    },
    required: ['command'],
  },
  risk: 'execute',
  async execute(input, context) {
    const workspace = new WorkspaceManager(context.workspaceRoot);
    const cwd = input.cwd ? workspace.resolve(input.cwd).absolute : workspace.workspaceRoot;

    const result = await shellTool.execute({ command: input.command, cwd, timeoutMs: input.timeoutMs }, context);
    if (!result.ok) {
      return failure('VALIDATION_RUN_ERROR', result.error?.message || 'Failed to run validation');
    }

    const data = result.data as { exitCode: number; stdout: string; stderr: string };
    return success(
      { exitCode: data.exitCode, stdout: data.stdout, stderr: data.stderr },
      { truncated: (data.stdout.length + data.stderr.length) > 10000 }
    );
  },
};
