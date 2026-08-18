/**
 * grep tool — search file contents with a regular expression.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';
import { WorkspaceManager, toWorkspacePath } from '../../agent/workspace.js';

export interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

export interface GrepSearchFile {
  absolute: string;
  file: string;
}

export const GREP_REGEX_TIMEOUT_MS = 10_000;
const MAX_GREP_RESULTS = 101;

class GrepTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Regular-expression search exceeded ${timeoutMs}ms and was terminated.`);
    this.name = 'GrepTimeoutError';
  }
}

// Regex execution happens in a worker because JavaScript RegExp matching is
// synchronous and cannot be interrupted on the main thread. A pathological
// user/LLM-generated expression therefore cannot wedge the CLI event loop.
const GREP_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');

try {
  const regex = new RegExp(workerData.pattern, 'g');
  const results = [];

  outer:
  for (const file of workerData.files) {
    const content = fs.readFileSync(file.absolute, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (regex.test(lines[i])) {
        results.push({ file: file.file, line: i + 1, text: lines[i].trim() });
        if (results.length >= workerData.maxResults) break outer;
      }
      regex.lastIndex = 0;
    }
  }

  parentPort.postMessage({ ok: true, results });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}
`;

/**
 * Execute regex matching off the main thread with a hard wall-clock timeout.
 * Exported for focused regression testing; callers normally use grepTool.
 */
export async function searchFilesWithRegex(
  files: GrepSearchFile[],
  pattern: string,
  timeoutMs = GREP_REGEX_TIMEOUT_MS
): Promise<GrepMatch[]> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('grep timeout must be a positive finite number');
  }

  const worker = new Worker(GREP_WORKER_SOURCE, {
    eval: true,
    workerData: { files, pattern, maxResults: MAX_GREP_RESULTS },
  });

  return await new Promise<GrepMatch[]>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      reject(new GrepTimeoutError(timeoutMs));
    }, timeoutMs);

    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };

    worker.once('message', (message: unknown) => {
      finish(() => {
        void worker.terminate();
        const payload = message as
          | { ok: true; results: GrepMatch[] }
          | { ok: false; error: string };
        if (payload?.ok === true && Array.isArray(payload.results)) {
          resolve(payload.results);
        } else {
          reject(new Error(payload && 'error' in payload ? payload.error : 'grep worker returned an invalid response'));
        }
      });
    });

    worker.once('error', (error) => {
      finish(() => reject(error));
    });

    worker.once('exit', (code) => {
      if (settled) return;
      finish(() => reject(new Error(`grep worker exited before returning results (code ${code})`)));
    });
  });
}

export const grepTool: AgentTool<{ pattern: string; paths?: string[] }, GrepMatch[]> = {
  name: 'grep',
  description: 'Search file contents with a regular expression.',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern' },
      paths: { type: 'array', items: { type: 'string' }, description: 'Files or directories to search' },
    },
    required: ['pattern'],
  },
  risk: 'read',
  async execute(input, context) {
    // Compilation itself is bounded; only matching runs in the worker.
    try {
      new RegExp(input.pattern);
    } catch (error) {
      return failure('INVALID_PATTERN', error instanceof Error ? error.message : String(error));
    }

    const workspace = new WorkspaceManager(
      context.workspaceRoot,
      context.workspace?.additionalRoots ?? []
    );
    const searchRoots = input.paths?.length ? input.paths : workspace.roots;
    const files: GrepSearchFile[] = [];

    function addFile(absolute: string, display: string): void {
      if (workspace.isBinaryFile(absolute)) return;
      files.push({ absolute, file: display });
    }

    function walk(current: string, baseRoot: string): void {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const absolute = path.join(current, entry.name);
        const display = baseRoot === workspace.workspaceRoot
          ? toWorkspacePath(path.relative(baseRoot, absolute))
          : toWorkspacePath(absolute);
        if (entry.name.startsWith('.') && entry.isDirectory()) continue;
        if (entry.name === 'node_modules' || entry.name === 'dist') continue;

        // Recursive directory enumeration must never follow a symlink out of
        // the approved workspace. Direct symlink paths still pass through
        // WorkspaceManager.resolve(), which validates their real target.
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          walk(absolute, baseRoot);
        } else if (entry.isFile()) {
          addFile(absolute, display);
        }
      }
    }

    try {
      for (const root of searchRoots) {
        const resolved = workspace.resolve(root);
        const stat = fs.statSync(resolved.absolute);
        if (stat.isDirectory()) {
          walk(resolved.absolute, resolved.root);
        } else if (stat.isFile()) {
          const display = resolved.root === workspace.workspaceRoot
            ? resolved.relative
            : toWorkspacePath(resolved.absolute);
          addFile(resolved.absolute, display);
        }
      }

      const results = await searchFilesWithRegex(files, input.pattern);
      const isTruncated = results.length > 100;
      const capped = isTruncated ? results.slice(0, 100) : results;
      return success(capped, {
        truncated: isTruncated,
        inspectedFiles: [...new Set(capped.map((row) => row.file))],
      });
    } catch (error) {
      const code = error instanceof GrepTimeoutError ? 'GREP_TIMEOUT' : 'GREP_ERROR';
      return failure(code, error instanceof Error ? error.message : String(error));
    }
  },
};
