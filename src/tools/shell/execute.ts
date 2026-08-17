/**
 * shell tool — execute a shell command starting in the workspace.
 *
 * The shell only constrains the starting cwd; it runs with the user's OS
 * account privileges and is not filesystem-sandboxed (VC-KIMI-056).
 */

import { spawn } from 'node:child_process';
import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';
import { WorkspaceManager } from '../../agent/workspace.js';
import { terminateProcessTree, forceKillProcessTree } from '../../lib/process-tree.js';

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
  /** True when the runtime/turn abort signal cancelled the process tree (VCL-058). */
  cancelled: boolean;
}

/**
 * Bounded accumulation of child process text output (VC-KIMI-019).
 *
 * Keeps the head, a bounded tail, the total bytes seen, and a truncation flag,
 * so a noisy or malicious command cannot grow process memory unboundedly.
 */
export class BoundedTextBuffer {
  private static readonly MAX_HEAD_CHARS = 50000;
  private static readonly MAX_TAIL_CHARS = 5000;

  private head = '';
  private tail = '';
  private totalBytes = 0;
  private truncated = false;

  append(chunk: string): void {
    if (!chunk) return;
    this.totalBytes += Buffer.byteLength(chunk, 'utf-8');

    if (this.head.length < BoundedTextBuffer.MAX_HEAD_CHARS) {
      const space = BoundedTextBuffer.MAX_HEAD_CHARS - this.head.length;
      this.head += chunk.slice(0, space);
      const overflow = chunk.slice(space);
      if (overflow) {
        this.truncated = true;
        this.tail = (this.tail + overflow).slice(-BoundedTextBuffer.MAX_TAIL_CHARS);
      }
    } else {
      this.truncated = true;
      this.tail = (this.tail + chunk).slice(-BoundedTextBuffer.MAX_TAIL_CHARS);
    }
  }

  get isTruncated(): boolean {
    return this.truncated;
  }

  toString(): string {
    if (!this.truncated) return this.head;
    return `${this.head}\n… [output truncated: ${this.totalBytes} bytes total] …\n${this.tail}`;
  }
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
  description: 'Executes a shell command starting in the workspace. The shell runs with your OS account privileges and is not filesystem-sandboxed.',
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
    // Ordinary local development commands are labeled 'execute' for UI risk
    // display only. The regex heuristic cannot establish safety, so `auto`
    // mode never auto-approves raw shell on this label (VCL-057): it requires
    // an explicit grant, approval, or yolo. Destructive/external patterns
    // above remain the conservative UI carve-outs.
    return 'execute';
  },
  async execute(input, context) {
    const workspace = new WorkspaceManager(context.workspaceRoot, context.workspace?.additionalRoots ?? []);
    const cwd = input.cwd ? workspace.resolve(input.cwd).absolute : workspace.workspaceRoot;
    const timeoutMs = input.timeoutMs ?? 120000;
    const start = Date.now();

    return new Promise((resolve) => {
      const shell = process.platform === 'win32' ? 'cmd.exe' : 'bash';
      const args = process.platform === 'win32' ? ['/c', input.command] : ['-c', input.command];
      // Run detached on non-Windows to allow killing the entire process group
      const child = spawn(shell, args, { cwd, env: buildShellEnv(cwd), detached: process.platform !== 'win32' });

      const stdoutBuffer = new BoundedTextBuffer();
      const stderrBuffer = new BoundedTextBuffer();
      let timedOut = false;
      let cancelled = false;

      // Kill the whole descendant tree on every platform (VC-KIMI-055).
      const killTree = () => {
        terminateProcessTree(child);
        setTimeout(() => forceKillProcessTree(child), 5000);
      };

      const timeout = setTimeout(() => {
        timedOut = true;
        killTree();
      }, timeoutMs);

      // Cancellation must terminate the subprocess tree, not just abandon it:
      // a turn abort stops any side effects the child is still producing
      // (VCL-058). `cancelled` is kept separate from `timedOut` so callers can
      // tell the two terminal states apart.
      const onAbort = () => {
        cancelled = true;
        killTree();
      };
      context.signal?.addEventListener('abort', onAbort);
      if (context.signal?.aborted) {
        cancelled = true;
        killTree();
      }

      child.stdout.on('data', (data) => { stdoutBuffer.append(data.toString()); });
      child.stderr.on('data', (data) => { stderrBuffer.append(data.toString()); });

      const cleanup = () => {
        clearTimeout(timeout);
        context.signal?.removeEventListener('abort', onAbort);
      };

      child.on('close', (exitCode) => {
        cleanup();
        const output: ShellOutput = {
          command: input.command,
          cwd,
          exitCode,
          stdout: stdoutBuffer.toString(),
          stderr: stderrBuffer.toString(),
          durationMs: Date.now() - start,
          timedOut,
          cancelled,
        };
        resolve(success(output));
      });

      child.on('error', (error) => {
        cleanup();
        resolve(failure('SHELL_ERROR', error.message));
      });
    });
  },
};
