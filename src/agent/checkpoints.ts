import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { isPathInside } from './workspace.js';

export interface Checkpoint {
  id: string;
  timestamp: string;
  operation: string;
  relativePath: string;
  /** Realpath of the owning workspace root; legacy entries restore to primary. */
  rootId?: string;
  originalContent: string | null;
  newContent: string | null;
  description?: string;
}

export interface CheckpointResult {
  ok: boolean;
  restored: string;
  operation: 'undo' | 'redo';
  error?: string;
}

export interface CheckpointState {
  index: number;
  count: number;
  canUndo: boolean;
  canRedo: boolean;
}

export class CheckpointManager {
  private readonly history: Checkpoint[] = [];
  private index = -1;
  private readonly storageDir: string;
  private readonly workspaceRoot: string;
  /** Allowed roots (primary first); used to revalidate restore targets (VCL-R3-003). */
  private readonly roots: string[];

  constructor(
    sessionId: string,
    workspaceRoot: string,
    storageRoot = path.join(os.homedir(), '.venice', 'sessions'),
    additionalRoots: string[] = []
  ) {
    this.workspaceRoot = workspaceRoot;
    this.roots = [workspaceRoot, ...additionalRoots.filter((r) => r && r !== workspaceRoot)];
    this.storageDir = path.join(storageRoot, sessionId, 'checkpoints');
    this.load();
  }

  record(checkpoint: Omit<Checkpoint, 'id' | 'timestamp'>): void {
    const entry: Checkpoint = {
      ...checkpoint,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };
    // Discard any redo entries after the current pointer.
    if (this.index < this.history.length - 1) {
      this.history.splice(this.index + 1);
    }
    this.history.push(entry);
    this.index = this.history.length - 1;
    this.save();
  }

  async undo(): Promise<CheckpointResult> {
    if (!this.canUndo()) {
      return { ok: false, restored: '', operation: 'undo' };
    }
    const checkpoint = this.history[this.index];
    const restoreError = await this.restore(checkpoint.originalContent, checkpoint.relativePath, checkpoint.rootId);
    if (restoreError) {
      return { ok: false, restored: checkpoint.relativePath, operation: 'undo', error: restoreError };
    }
    this.index--;
    this.save();
    return { ok: true, restored: checkpoint.relativePath, operation: 'undo' };
  }

  async redo(): Promise<CheckpointResult> {
    if (!this.canRedo()) {
      return { ok: false, restored: '', operation: 'redo' };
    }
    this.index++;
    const checkpoint = this.history[this.index];
    const restoreError = await this.restore(checkpoint.newContent, checkpoint.relativePath, checkpoint.rootId);
    if (restoreError) {
      return { ok: false, restored: checkpoint.relativePath, operation: 'redo', error: restoreError };
    }
    this.save();
    return { ok: true, restored: checkpoint.relativePath, operation: 'redo' };
  }

  list(): Checkpoint[] {
    return this.history.map((c, i) => ({
      ...c,
      description: `${i === this.index ? '* ' : ''}${c.operation} ${c.relativePath}`,
    }));
  }

  state(): CheckpointState {
    return {
      index: this.index,
      count: this.history.length,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    };
  }

  canUndo(): boolean {
    return this.index >= 0;
  }

  canRedo(): boolean {
    return this.index < this.history.length - 1;
  }

  /**
   * Restore a checkpoint, revalidating the target against the current
   * workspace scope on every undo/redo (VCL-R3-003). A checkpoint whose root
   * is no longer part of the workspace, or whose path escapes its root, is
   * refused rather than written to the wrong location.
   */
  private async restore(
    content: string | null,
    relativePath: string,
    rootId?: string
  ): Promise<string | undefined> {
    // Legacy checkpoints (no rootId) restore to the primary root.
    const root = rootId ? this.roots.find((r) => r === rootId) : this.workspaceRoot;
    if (!root) {
      return `Checkpoint target root is no longer part of the workspace: ${rootId}`;
    }
    const absolute = path.resolve(root, relativePath);
    if (!isPathInside(root, absolute)) {
      return `Checkpoint target escapes the workspace: ${relativePath}`;
    }
    if (content === null) {
      if (fs.existsSync(absolute)) {
        fs.rmSync(absolute);
      }
      return undefined;
    }
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, 'utf-8');
    return undefined;
  }

  private save(): void {
    fs.mkdirSync(this.storageDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      path.join(this.storageDir, 'history.json'),
      JSON.stringify({ history: this.history, index: this.index }, null, 2),
      { mode: 0o600 }
    );
  }

  private load(): void {
    const file = path.join(this.storageDir, 'history.json');
    if (!fs.existsSync(file)) return;
    try {
      const stored = JSON.parse(fs.readFileSync(file, 'utf-8')) as {
        history: Checkpoint[];
        index: number;
      };
      this.history.push(...stored.history);
      this.index = stored.index;
    } catch {
      // Ignore corrupt checkpoint state.
    }
  }
}
