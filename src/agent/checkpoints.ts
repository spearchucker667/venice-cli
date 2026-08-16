import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';

export interface Checkpoint {
  id: string;
  timestamp: string;
  operation: string;
  relativePath: string;
  originalContent: string | null;
  newContent: string | null;
  description?: string;
}

export interface CheckpointResult {
  ok: boolean;
  restored: string;
  operation: 'undo' | 'redo';
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

  constructor(
    sessionId: string,
    workspaceRoot: string,
    storageRoot = path.join(os.homedir(), '.venice', 'sessions')
  ) {
    this.workspaceRoot = workspaceRoot;
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
    await this.restore(checkpoint.originalContent, checkpoint.relativePath);
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
    await this.restore(checkpoint.newContent, checkpoint.relativePath);
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

  private async restore(content: string | null, relativePath: string): Promise<void> {
    const absolute = path.join(this.workspaceRoot, relativePath);
    if (content === null) {
      if (fs.existsSync(absolute)) {
        fs.rmSync(absolute);
      }
      return;
    }
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content, 'utf-8');
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
