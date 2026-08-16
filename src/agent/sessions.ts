/**
 * Durable session persistence for the agent runtime.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { SecretRedactor, collectKnownSecrets } from '../lib/redactor.js';
import type { AgentEvent } from './events.js';
import type { AgentState } from './types.js';

const SESSIONS_ROOT = path.join(os.homedir(), '.venice', 'sessions');

export interface StoredSession {
  sessionId: string;
  state: AgentState;
  createdAt: string;
  updatedAt: string;
  events?: AgentEvent[];
}

interface SessionFileOps {
  writeFileSync: typeof fs.writeFileSync;
  renameSync: typeof fs.renameSync;
  unlinkSync: typeof fs.unlinkSync;
  openSync: typeof fs.openSync;
  fsyncSync: typeof fs.fsyncSync;
  closeSync: typeof fs.closeSync;
}

export class SessionManager {
  readonly root: string;
  private readonly redactor: SecretRedactor;

  constructor(root = SESSIONS_ROOT, private readonly fileOps: SessionFileOps = fs) {
    this.root = root;
    this.redactor = new SecretRedactor(collectKnownSecrets());
  }

  ensureDir(): void {
    if (!fs.existsSync(this.root)) {
      fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    } else {
      // Validate permissions if it exists
      try {
        const stat = fs.statSync(this.root);
        // Ensure not world readable/writable
        if ((stat.mode & 0o077) !== 0) {
          fs.chmodSync(this.root, 0o700);
        }
      } catch {
        // Ignore chmod errors on unsupported platforms
      }
    }
  }

  save(state: AgentState, events: AgentEvent[]): void {
    this.ensureDir();
    const dir = this.sessionDir(state.sessionId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    const redactedState = this.redactor.redact(state);
    const redactedEvents = this.redactor.redact(events);

    const existing = this.readStored(path.join(dir, 'session.json'));
    const stored: StoredSession = {
      sessionId: redactedState.sessionId,
      state: redactedState,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      events: redactedEvents,
    };

    this.removeStaleTemps(dir);
    this.writeAtomic(path.join(dir, 'session.json'), JSON.stringify(stored, null, 2));
    // These files are convenient for inspection, but session.json is the canonical
    // commit record so an interruption cannot mix state and events generations.
    try {
      this.writeAtomic(path.join(dir, 'messages.jsonl'), redactedState.messages.map((m) => JSON.stringify(m)).join('\n') + '\n');
      this.writeAtomic(path.join(dir, 'events.jsonl'), redactedEvents.map((e) => JSON.stringify(e)).join('\n') + '\n');
    } catch {
      // A future save repairs projections from the canonical record.
    }
  }

  load(sessionId: string, workspaceRoot?: string): { state: AgentState; events: AgentEvent[] } | undefined {
    let dir: string;
    try { dir = this.sessionDir(sessionId); } catch { return undefined; }
    const sessionPath = path.join(dir, 'session.json');
    if (!fs.existsSync(sessionPath)) return undefined;

    const stored = this.readStored(sessionPath);
    if (!stored) return undefined;
    if (workspaceRoot && canonicalPath(stored.state.workspaceRoot) !== canonicalPath(workspaceRoot)) {
      return undefined;
    }
    const events: AgentEvent[] = Array.isArray(stored.events) ? stored.events : [];
    const eventsPath = path.join(dir, 'events.jsonl');
    if (!stored.events && fs.existsSync(eventsPath)) {
      const lines = fs.readFileSync(eventsPath, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try { events.push(JSON.parse(line) as AgentEvent); } catch { /* skip corrupt projection lines */ }
      }
    }
    return { state: stored.state, events };
  }

  list(workspaceRoot?: string): StoredSession[] {
    this.ensureDir();
    const sessions: StoredSession[] = [];
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sessionPath = path.join(this.root, entry.name, 'session.json');
      if (!fs.existsSync(sessionPath)) continue;
      try {
        const stored = JSON.parse(fs.readFileSync(sessionPath, 'utf-8')) as StoredSession;
        if (!workspaceRoot || canonicalPath(stored.state.workspaceRoot) === canonicalPath(workspaceRoot)) {
          sessions.push(stored);
        }
      } catch {
        // skip corrupt
      }
    }
    return sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  delete(sessionId: string): boolean {
    let dir: string;
    try { dir = this.sessionDir(sessionId); } catch { return false; }
    if (!fs.existsSync(dir)) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  }

  private readStored(filePath: string): StoredSession | undefined {
    if (!fs.existsSync(filePath)) return undefined;
    try {
      const value = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<StoredSession>;
      if (!value || typeof value !== 'object' || typeof value.sessionId !== 'string' ||
          typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string' ||
          !value.state || typeof value.state !== 'object') return undefined;
      return value as StoredSession;
    } catch {
      return undefined;
    }
  }

  private writeAtomic(filePath: string, data: string): void {
    const tmpPath = `${filePath}.tmp.${process.pid}.${randomUUID()}`;
    let descriptor: number | undefined;
    try {
      this.fileOps.writeFileSync(tmpPath, data, { mode: 0o600 });
      descriptor = this.fileOps.openSync(tmpPath, 'r+');
      this.fileOps.fsyncSync(descriptor);
      this.fileOps.closeSync(descriptor);
      descriptor = undefined;
      this.fileOps.renameSync(tmpPath, filePath);
      
      // POSIX directory fsync for metadata durability
      try {
        const dir = path.dirname(filePath);
        const dirDescriptor = this.fileOps.openSync(dir, 'r');
        this.fileOps.fsyncSync(dirDescriptor);
        this.fileOps.closeSync(dirDescriptor);
      } catch {
        // Ignored; directory fsync is not supported on all platforms (e.g. Windows)
      }
    } catch (error) {
      if (descriptor !== undefined) {
        try { this.fileOps.closeSync(descriptor); } catch { /* preserve original error */ }
      }
      try { this.fileOps.unlinkSync(tmpPath); } catch { /* temp may not exist */ }
      throw error;
    }
  }

  private removeStaleTemps(dir: string): void {
    for (const entry of fs.readdirSync(dir)) {
      if (!/^(session\.json|messages\.jsonl|events\.jsonl)\.tmp\./.test(entry)) continue;
      const target = path.join(dir, entry);
      try {
        if (Date.now() - fs.statSync(target).mtimeMs > 5 * 60 * 1000) fs.unlinkSync(target);
      } catch { /* best-effort cleanup */ }
    }
  }

  private sessionDir(sessionId: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(sessionId) || sessionId === '.' || sessionId === '..') {
      throw new Error('Invalid session ID');
    }
    return path.join(this.root, sessionId);
  }
}

function canonicalPath(input: string): string {
  try {
    return fs.realpathSync(input);
  } catch {
    return path.resolve(input);
  }
}
