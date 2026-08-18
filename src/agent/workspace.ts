/**
 * Workspace manager: discovers workspace root and enforces path safety.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WorkspaceFileRef } from './types.js';

export function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export function toWorkspacePath(value: string): string {
  return value.split(path.sep).join('/');
}

/** Build a root-aware file ref from a root realpath and a relative path. */
export function toFileRef(root: string, relativePath: string): WorkspaceFileRef {
  return { rootId: root, relativePath: toWorkspacePath(relativePath) };
}

/**
 * Human/context display for a file ref: primary-root files show just the
 * relative path; files in additional roots stay unambiguous (VCL-R3-004).
 */
export function formatFileRef(ref: WorkspaceFileRef, primaryRoot: string): string {
  return ref.rootId === primaryRoot ? ref.relativePath : `${ref.relativePath} (${ref.rootId})`;
}

/** Accept a bare relative path (primary root) or a structured ref. */
export function normalizeFileRef(ref: WorkspaceFileRef | string, primaryRoot: string): WorkspaceFileRef {
  return typeof ref === 'string' ? toFileRef(primaryRoot, ref) : ref;
}

export class WorkspaceManager {
  private readonly root: string;
  private readonly extraRoots: string[];

  constructor(root: string, additionalRoots: string[] = []) {
    this.root = fs.realpathSync(root);
    this.extraRoots = [];
    for (const additional of additionalRoots) {
      if (!additional) continue;
      const real = fs.realpathSync(additional);
      if (real !== this.root && !this.extraRoots.includes(real)) {
        this.extraRoots.push(real);
      }
    }
  }

  get workspaceRoot(): string {
    return this.root;
  }

  /** The primary workspace root (realpath), the canonical `primaryRoot` id. */
  get primaryRoot(): string {
    return this.root;
  }

  /** Additional approved roots (realpaths), de-duplicated against the primary root. */
  get additionalRoots(): string[] {
    return this.extraRoots;
  }

  /** All registered roots: primary first, then additional (VC-KIMI-044). */
  get roots(): string[] {
    return [this.root, ...this.extraRoots];
  }

  resolve(inputPath: string): { absolute: string; relative: string; root: string } {
    if (path.isAbsolute(inputPath)) {
      const root = this.matchingRoot(inputPath);
      if (!root) {
        throw new Error(`Path outside workspace: ${inputPath}`);
      }
      const absolute = this.resolveAbsolute(inputPath, root);
      return { absolute, relative: toWorkspacePath(path.relative(root, absolute)), root };
    }

    const absolute = this.resolveAbsolute(path.resolve(this.root, inputPath), this.root);
    return {
      absolute,
      relative: toWorkspacePath(path.relative(this.root, absolute)),
      root: this.root,
    };
  }

  isInsideWorkspace(absolutePath: string): boolean {
    const real = fs.existsSync(absolutePath) ? fs.realpathSync(absolutePath) : absolutePath;
    return this.roots.some((root) => isPathInside(root, real));
  }

  assertInsideWorkspace(absolutePath: string): void {
    if (!this.isInsideWorkspace(absolutePath)) {
      throw new Error(`Path outside workspace: ${absolutePath}`);
    }
  }

  private matchingRoot(absolutePath: string): string | undefined {
    const real = fs.existsSync(absolutePath)
      ? fs.realpathSync(absolutePath)
      : path.normalize(absolutePath);
    return this.roots.find((root) => isPathInside(root, real));
  }

  private resolveAbsolute(rawAbsolute: string, root: string): string {
    const absolute = path.normalize(rawAbsolute);

    if (fs.existsSync(absolute)) {
      const real = fs.realpathSync(absolute);
      if (!isPathInside(root, real)) {
        throw new Error(`Path outside workspace: ${rawAbsolute}`);
      }
      return real;
    }

    // Resolve the deepest existing ancestor to prevent symlink escapes.
    let ancestor = absolute;
    while (ancestor !== root) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) break;
      if (fs.existsSync(parent)) {
        const realParent = fs.realpathSync(parent);
        if (!isPathInside(root, realParent)) {
          throw new Error(`Path outside workspace: ${rawAbsolute}`);
        }
        break;
      }
      ancestor = parent;
    }

    if (!isPathInside(root, absolute)) {
      throw new Error(`Path outside workspace: ${rawAbsolute}`);
    }

    return absolute;
  }

  isBinaryFile(absolutePath: string): boolean {
    const fd = fs.openSync(absolutePath, 'r');
    try {
      const buffer = Buffer.alloc(8000);
      const bytesRead = fs.readSync(fd, buffer, 0, 8000, 0);
      for (let i = 0; i < bytesRead; i++) {
        if (buffer[i] === 0) return true;
      }
      return false;
    } finally {
      fs.closeSync(fd);
    }
  }
}

/**
 * Resolve the workspace anchor used by the runtime: return the canonical Git
 * root when `cwd` is inside a repository, otherwise return the canonical cwd.
 *
 * The historical function name is retained because the runtime imports it as
 * its workspace detector. Returning a realpath in the non-Git case prevents a
 * relative or symlinked `--cwd` from producing session/config identities that
 * disagree with WorkspaceManager's canonical root.
 */
export function detectGitRoot(cwd: string): string {
  const canonicalCwd = fs.realpathSync(path.resolve(cwd));
  let current = canonicalCwd;
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) {
      return fs.realpathSync(current);
    }
    const parent = path.dirname(current);
    if (parent === current) return canonicalCwd;
    current = parent;
  }
}
