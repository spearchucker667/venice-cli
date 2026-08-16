/**
 * Shared session import service.
 *
 * Used by both the CLI (`venice import`) and the TUI (`/import`). Importing
 * must actually persist the session before it can be resumed (VC-KIMI-011),
 * and the imported data must survive schema/identity validation (VC-KIMI-061).
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { SessionManager, type StoredSession } from './sessions.js';
import type { AgentEvent } from './events.js';
import type { AgentState } from './types.js';

export interface ImportSessionOptions {
  /** Overwrite a locally existing session with the same id. */
  force?: boolean;
  /** Assign a new session id (fork) instead of importing under the stored id. */
  fork?: boolean;
}

export interface ImportSessionResult {
  sessionId: string;
  importedAs: 'original' | 'forked';
  state: AgentState;
  events: AgentEvent[];
}

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

export class SessionImportService {
  constructor(private readonly manager: SessionManager = new SessionManager()) {}

  importFile(filePath: string, options: ImportSessionOptions = {}): ImportSessionResult {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    let data: StoredSession;
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StoredSession;
    } catch (error) {
      throw new Error(
        `Failed to parse session file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return this.importData(data, options);
  }

  importData(data: StoredSession, options: ImportSessionOptions = {}): ImportSessionResult {
    if (!data || typeof data !== 'object' || !data.state || typeof data.state !== 'object') {
      throw new Error('Invalid session export file: missing state');
    }
    const state = data.state as AgentState;
    if (typeof state.sessionId !== 'string' || !SESSION_ID_PATTERN.test(state.sessionId)) {
      throw new Error('Invalid session export file: missing or invalid sessionId');
    }
    if (
      typeof state.workspaceRoot !== 'string' ||
      !state.workspaceRoot.trim() ||
      !state.mode ||
      typeof state.mode !== 'object'
    ) {
      throw new Error('Invalid session export file: missing workspace or mode');
    }
    const events: AgentEvent[] = Array.isArray(data.events) ? data.events : [];

    if (options.fork) {
      const forked: AgentState = {
        ...state,
        sessionId: randomUUID(),
        parentSessionId: state.parentSessionId ?? state.sessionId,
        messages: [...state.messages],
        changedFiles: [...state.changedFiles],
        toolHistory: [...state.toolHistory],
      };
      this.manager.save(forked, events);
      return { sessionId: forked.sessionId, importedAs: 'forked', state: forked, events };
    }

    const existing = this.manager.load(state.sessionId);
    if (existing && !options.force) {
      throw new Error(
        `Session ${state.sessionId} already exists locally. Use --force to overwrite or --fork to import under a new id.`
      );
    }

    this.manager.save(state, events);
    return { sessionId: state.sessionId, importedAs: 'original', state, events };
  }
}
