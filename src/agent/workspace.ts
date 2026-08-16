/**
 * Workspace manager: discovers workspace root and enforces path safety.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

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

export class WorkspaceManager {
  private readonly root: string;
  private readonly additionalRoots: string[];
  private readonly changed = new Set<string>();

  constructor(root: string, additionalRoots: string[] = []) {
    this.root = fs.realpathSync(root);
    this.additionalRoots = [];
    for (const additional of additionalRoots) {
      if (!additional) continue;
      const real = fs.realpathSync(additional);
      if (real !== this.root && !this.additionalRoots.includes(real)) {
        this.additionalRoots.push(real);
      }
    }
  }

  get workspaceRoot(): string {
    return this.root;
  }

  /** All registered roots: primary first, then additional (VC-KIMI-044). */
  get roots(): string[] {
    return [this.root, ...this.additionalRoots];
  }

  get changedFiles(): string[] {
    return Array.from(this.changed);
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

  markChanged(relativePath: string): void {
    this.changed.add(toWorkspacePath(path.normalize(relativePath)));
  }

  /**
   * Record a resolved path as changed. Files in additional roots are tracked
   * by their absolute path so the persisted list stays unambiguous.
   */
  markChangedResolved(resolved: { absolute: string; relative: string; root: string }): void {
    if (resolved.root === this.root) {
      this.markChanged(resolved.relative);
    } else {
      this.changed.add(toWorkspacePath(resolved.absolute));
    }
  }

  replaceChangedFiles(relativePaths: string[]): void {
    this.changed.clear();
    for (const relativePath of relativePaths) this.markChanged(relativePath);
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

export function detectGitRoot(cwd: string): string | undefined {
  let current = cwd;
  while (true) {
    if (fs.existsSync(path.join(current, '.git'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}
