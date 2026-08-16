/**
 * Workspace output helpers for Venice media tools.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { WorkspaceManager } from '../../agent/workspace.js';

export function resolveWorkspaceFile(workspaceRoot: string, inputPath: string): { absolute: string; relative: string } {
  const workspace = new WorkspaceManager(workspaceRoot);
  return workspace.resolve(inputPath);
}

export function writeWorkspaceBytes(
  workspaceRoot: string,
  outputPath: string,
  bytes: Buffer | ArrayBuffer
): { absolute: string; relative: string } {
  const workspace = new WorkspaceManager(workspaceRoot);
  const resolved = workspace.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolved.absolute), { recursive: true });
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(new Uint8Array(bytes));
  fs.writeFileSync(resolved.absolute, buffer);
  return resolved;
}
