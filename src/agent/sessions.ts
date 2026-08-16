/**
 * Durable session persistence for the agent runtime.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AgentEvent } from './events.js';
import type { AgentState } from './types.js';

const SESSIONS_ROOT = path.join(os.homedir(), '.venice', 'sessions');

export interface StoredSession {
  sessionId: string;
  state: AgentState;
  createdAt: string;
  updatedAt: string;
}

export class SessionManager {
  readonly root: string;

  constructor(root = SESSIONS_ROOT) {
    this.root = root;
  }

  ensureDir(): void {
    if (!fs.existsSync(this.root)) {
      fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    }
  }

  save(state: AgentState, events: AgentEvent[]): void {
    this.ensureDir();
    const dir = path.join(this.root, state.sessionId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    const stored: StoredSession = {
      sessionId: state.sessionId,
      state,
      createdAt: fs.existsSync(path.join(dir, 'session.json'))
        ? (JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf-8')) as StoredSession).createdAt
        : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify(stored, null, 2), { mode: 0o600 });

    const messagesPath = path.join(dir, 'messages.jsonl');
    fs.writeFileSync(messagesPath, state.messages.map((m) => JSON.stringify(m)).join('\n') + '\n', { mode: 0o600 });

    const eventsPath = path.join(dir, 'events.jsonl');
    fs.writeFileSync(eventsPath, events.map((e) => JSON.stringify(e)).join('\n') + '\n', { mode: 0o600 });
  }

  load(sessionId: string): { state: AgentState; events: AgentEvent[] } | undefined {
    const dir = path.join(this.root, sessionId);
    const sessionPath = path.join(dir, 'session.json');
    if (!fs.existsSync(sessionPath)) return undefined;

    const stored = JSON.parse(fs.readFileSync(sessionPath, 'utf-8')) as StoredSession;
    const events: AgentEvent[] = [];
    const eventsPath = path.join(dir, 'events.jsonl');
    if (fs.existsSync(eventsPath)) {
      const lines = fs.readFileSync(eventsPath, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) events.push(JSON.parse(line));
    }
    return { state: stored.state, events };
  }

  list(): StoredSession[] {
    this.ensureDir();
    const sessions: StoredSession[] = [];
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sessionPath = path.join(this.root, entry.name, 'session.json');
      if (!fs.existsSync(sessionPath)) continue;
      try {
        sessions.push(JSON.parse(fs.readFileSync(sessionPath, 'utf-8')) as StoredSession);
      } catch {
        // skip corrupt
      }
    }
    return sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  delete(sessionId: string): boolean {
    const dir = path.join(this.root, sessionId);
    if (!fs.existsSync(dir)) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  }
}
