/**
 * Cross-platform process-tree termination.
 *
 * POSIX spawns children detached so the negative PID addresses the whole
 * process group. Windows has no POSIX process groups, so `taskkill /T` is
 * used to terminate the entire descendant tree (VC-KIMI-055). Both paths fall
 * back to signalling the direct child when the tree leader is already gone.
 */

import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Terminate the process tree gracefully (SIGTERM on POSIX, `taskkill /T` on
 * Windows).
 */
export function terminateProcessTree(child: ChildProcess): void {
  killProcessTree(child, 'SIGTERM', false);
}

/**
 * Force-kill the process tree (SIGKILL on POSIX, `taskkill /T /F` on Windows).
 */
export function forceKillProcessTree(child: ChildProcess): void {
  killProcessTree(child, 'SIGKILL', true);
}

function killProcessTree(child: ChildProcess, posixSignal: 'SIGTERM' | 'SIGKILL', force: boolean): void {
  if (process.platform === 'win32') {
    if (child.pid) {
      try {
        // /T terminates the child and all of its descendants; /F forces it.
        spawn('taskkill', ['/pid', String(child.pid), '/T', ...(force ? ['/F'] : [])], {
          stdio: 'ignore',
          windowsHide: true,
        });
        return;
      } catch {
        // Fall through to the direct-child signal.
      }
    }
  } else if (child.pid) {
    try {
      process.kill(-child.pid, posixSignal);
      return;
    } catch {
      // Fall through to the direct-child signal.
    }
  }
  child.kill(posixSignal);
}
