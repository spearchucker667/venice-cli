/**
 * shell tool — execute a controlled shell command inside the workspace.
 */

import { spawn } from 'node:child_process';
import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';
import { WorkspaceManager } from '../../agent/workspace.js';

export interface ShellInput {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

export interface ShellOutput {
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export const shellTool: AgentTool<ShellInput, ShellOutput> = {
  name: 'shell',
  description: 'Execute a shell command inside the workspace.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string' },
      cwd: { type: 'string', description: 'Working directory relative to workspace root' },
      timeoutMs: { type: 'number' },
    },
    required: ['command'],
  },
  risk: 'execute',
  async execute(input, context) {
    const workspace = new WorkspaceManager(context.workspaceRoot);
    const cwd = input.cwd ? workspace.resolve(input.cwd).absolute : workspace.workspaceRoot;
    const timeoutMs = input.timeoutMs ?? 120000;
    const start = Date.now();

    return new Promise((resolve) => {
      const shell = process.platform === 'win32' ? 'cmd.exe' : 'bash';
      const args = process.platform === 'win32' ? ['/c', input.command] : ['-c', input.command];
      const child = spawn(shell, args, { cwd, env: { ...process.env, PWD: cwd } });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000);
      }, timeoutMs);

      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });

      child.on('close', (exitCode) => {
        clearTimeout(timeout);
        const output: ShellOutput = {
          command: input.command,
          cwd,
          exitCode,
          stdout: stdout.slice(0, 50000),
          stderr: stderr.slice(0, 50000),
          durationMs: Date.now() - start,
          timedOut,
        };
        resolve(success(output));
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        resolve(failure('SHELL_ERROR', error.message));
      });
    });
  },
};
