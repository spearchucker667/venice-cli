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

export function buildShellEnv(cwd: string): NodeJS.ProcessEnv {
  const keep = [
    'PATH',
    'LANG',
    'LC_ALL',
    'TERM',
    'TMPDIR',
    'TEMP',
    'TMP',
    'SystemRoot',
    'ComSpec',
    'PATHEXT',
    'HOME',
    'USERPROFILE',
    'USER',
    'USERNAME',
    'SHELL',
    'LOGNAME',
  ];

  const env: NodeJS.ProcessEnv = { PWD: cwd };
  for (const key of keep) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
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
  risk: (input: unknown) => {
    const command = typeof input === 'object' && input !== null
      ? String((input as Record<string, unknown>).command || '')
      : '';
    // Destructive: data loss or system-level damage.
    if (/\brm\b[^\n]*\s-rf|\bmkfs\b|\bdd\b|\bformat\b|:{\s*:\|:&\s*};/i.test(command)) {
      return 'destructive';
    }
    // External side effects: network, remote systems, package publishing,
    // and privilege escalation. `auto` mode prompts for these.
    if (
      /\bsudo\b/i.test(command) ||
      /\b(curl|wget|ssh|scp|sftp|telnet|nc|ncat|ping|nslookup|dig|traceroute|whois|aws|gcloud|az)\b/i.test(command) ||
      /\b(git|docker|npm|npx|yarn|pnpm|pip|pip3|brew|apt|apt-get|yum|dnf)\s+(push|publish|deploy|login|logout|install\s+-g)\b/i.test(command)
    ) {
      return 'external_side_effect';
    }
    // Ordinary local development commands (build, test, ls, git status...)
    // are 'execute' so `auto` mode can auto-approve them consistently with
    // its documented semantics (VC-KIMI-057). This heuristic cannot
    // perfectly determine safety; destructive/external patterns above are
    // the conservative carve-outs.
    return 'execute';
  },
  async execute(input, context) {
    const workspace = new WorkspaceManager(context.workspaceRoot);
    const cwd = input.cwd ? workspace.resolve(input.cwd).absolute : workspace.workspaceRoot;
    const timeoutMs = input.timeoutMs ?? 120000;
    const start = Date.now();

    return new Promise((resolve) => {
      const shell = process.platform === 'win32' ? 'cmd.exe' : 'bash';
      const args = process.platform === 'win32' ? ['/c', input.command] : ['-c', input.command];
      // Run detached on non-Windows to allow killing the entire process group
      const child = spawn(shell, args, { cwd, env: buildShellEnv(cwd), detached: process.platform !== 'win32' });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        if (process.platform === 'win32') {
          child.kill('SIGTERM');
          setTimeout(() => child.kill('SIGKILL'), 5000);
        } else if (child.pid) {
          try {
            process.kill(-child.pid, 'SIGTERM');
            setTimeout(() => {
              try {
                process.kill(-child.pid!, 'SIGKILL');
              } catch {
                // ignore
              }
            }, 5000);
          } catch {
            // ignore
          }
        }
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
