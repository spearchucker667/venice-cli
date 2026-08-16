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
  private readonly changed = new Set<string>();

  constructor(root: string) {
    this.root = fs.realpathSync(root);
  }

  get workspaceRoot(): string {
    return this.root;
  }

  get changedFiles(): string[] {
    return Array.from(this.changed);
  }

  resolve(inputPath: string): { absolute: string; relative: string } {
    if (path.isAbsolute(inputPath) && !this.isInsideWorkspace(inputPath)) {
      throw new Error(`Path outside workspace: ${inputPath}`);
    }

    let absolute = path.isAbsolute(inputPath)
      ? path.normalize(inputPath)
      : path.resolve(this.root, inputPath);

    // Resolve symlinks for existing paths, and for non-existent paths resolve
    // the deepest existing ancestor to prevent symlink escapes.
    if (fs.existsSync(absolute)) {
      absolute = fs.realpathSync(absolute);
    } else {
      let ancestor = absolute;
      while (ancestor !== this.root) {
        const parent = path.dirname(ancestor);
        if (parent === ancestor) break;
        if (fs.existsSync(parent)) {
          const realParent = fs.realpathSync(parent);
          this.assertInsideWorkspace(realParent);
          break;
        }
        ancestor = parent;
      }
    }

    const relative = toWorkspacePath(path.relative(this.root, absolute));

    if (!isPathInside(this.root, absolute)) {
      throw new Error(`Path outside workspace: ${inputPath}`);
    }

    return { absolute, relative };
  }

  isInsideWorkspace(absolutePath: string): boolean {
    const real = fs.existsSync(absolutePath) ? fs.realpathSync(absolutePath) : absolutePath;
    return isPathInside(this.root, real);
  }

  assertInsideWorkspace(absolutePath: string): void {
    if (!this.isInsideWorkspace(absolutePath)) {
      throw new Error(`Path outside workspace: ${absolutePath}`);
    }
  }

  markChanged(relativePath: string): void {
    this.changed.add(toWorkspacePath(path.normalize(relativePath)));
  }

  replaceChangedFiles(relativePaths: string[]): void {
    this.changed.clear();
    for (const relativePath of relativePaths) this.markChanged(relativePath);
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
