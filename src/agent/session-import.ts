/**
 * Shared session import service.
 *
 * Used by both the CLI (`venice import`) and the TUI (`/import`). Importing
 * must actually persist the session before it can be resumed (VC-KIMI-011),
 * the imported data must survive schema/identity validation (VC-KIMI-061),
 * and future schema versions must be rejected explicitly (VC-KIMI-062).
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { SessionManager, SESSION_SCHEMA_VERSION, type StoredSession } from './sessions.js';
import type { AgentEvent } from './events.js';
import { isWorkspaceFileRef, type AgentState, type WorkspaceFileRef } from './types.js';
import { isZipArchive, readZipEntry } from '../lib/zip.js';

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
    const raw = fs.readFileSync(filePath);
    let data: StoredSession;

    if (isZipArchive(raw)) {
      // Debug archive round-trip (VC-KIMI-059/012): the canonical payload is
      // `session.json` inside the zip.
      const sessionJson = readZipEntry(raw, 'session.json');
      if (!sessionJson) {
        throw new Error('Invalid debug archive: missing session.json');
      }
      try {
        data = JSON.parse(sessionJson.toString('utf-8')) as StoredSession;
      } catch (error) {
        throw new Error(
          `Failed to parse session.json in debug archive: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    } else {
      try {
        data = JSON.parse(raw.toString('utf-8')) as StoredSession;
      } catch (error) {
        throw new Error(
          `Failed to parse session file: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return this.importData(data, options);
  }

  importData(data: StoredSession, options: ImportSessionOptions = {}): ImportSessionResult {
    if (!data || typeof data !== 'object' || !data.state || typeof data.state !== 'object') {
      throw new Error('Invalid session export file: missing state');
    }

    // Explicitly reject future schema versions rather than silently
    // misinterpreting them (VC-KIMI-062).
    if (typeof data.schemaVersion === 'number' && data.schemaVersion > SESSION_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported session schema version ${data.schemaVersion}; this build supports up to ${SESSION_SCHEMA_VERSION}`
      );
    }

    const state = normalizeImportedState(data.state);

    // Identity must be consistent: the top-level id, the stored id, and the
    // state id must all agree (work order §11).
    if (typeof data.sessionId !== 'string' || !SESSION_ID_PATTERN.test(data.sessionId)) {
      throw new Error('Invalid session export file: missing or invalid sessionId');
    }
    if (data.sessionId !== state.sessionId) {
      throw new Error('Invalid session export file: sessionId does not match the stored state');
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

/**
 * Repair/validate an imported state so that later runtime code can rely on the
 * structural invariants (arrays, workspace descriptor, mode) without crashing
 * (VC-KIMI-061).
 */
function normalizeImportedState(input: unknown): AgentState {
  const state = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const workspaceRoot = typeof state.workspaceRoot === 'string' ? state.workspaceRoot : '';
  if (!workspaceRoot.trim()) {
    throw new Error('Invalid session export file: missing workspace');
  }

  const sessionId = typeof state.sessionId === 'string' ? state.sessionId : '';
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error('Invalid session export file: missing or invalid sessionId');
  }

  const rawWorkspace = (typeof state.workspace === 'object' && state.workspace !== null
    ? state.workspace
    : {}) as Record<string, unknown>;
  const additionalRoots = Array.isArray(rawWorkspace.additionalRoots)
    ? rawWorkspace.additionalRoots.filter((root): root is string => typeof root === 'string')
    : [];

  if (!state.mode || typeof state.mode !== 'object') {
    throw new Error('Invalid session export file: missing workspace or mode');
  }
  const rawMode = state.mode as Record<string, unknown>;
  const mode = {
    inputMode: rawMode.inputMode === 'shell' ? ('shell' as const) : ('agent' as const),
    operatingMode: rawMode.operatingMode === 'plan' ? ('plan' as const) : ('agent' as const),
    permissionMode:
      rawMode.permissionMode === 'auto' || rawMode.permissionMode === 'yolo' || rawMode.permissionMode === 'auto-edit'
        ? (rawMode.permissionMode as 'auto' | 'yolo' | 'auto-edit')
        : ('suggest' as const),
  };

  const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

  // Guarded passthrough for durable optional fields (VCL-R3-009): a field is
  // preserved only when it has the expected shape, so a malformed export can
  // never poison the resumed runtime, and a well-formed one round-trips.
  const objectField = (value: unknown, guard: (v: Record<string, unknown>) => boolean): Record<string, unknown> | undefined =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && guard(value as Record<string, unknown>)
      ? (value as Record<string, unknown>)
      : undefined;
  const numberField = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  const booleanField = (value: unknown): boolean | undefined =>
    typeof value === 'boolean' ? value : undefined;

  const primaryRoot = typeof rawWorkspace.primaryRoot === 'string' ? rawWorkspace.primaryRoot : workspaceRoot;

  // Root-aware changed-file refs; legacy string entries are normalized to the
  // primary root so identity stays unambiguous (VCL-R3-004).
  const changedFiles = array(state.changedFiles)
    .filter((f): f is WorkspaceFileRef | string =>
      typeof f === 'string' || isWorkspaceFileRef(f)
    )
    .map((f) => (typeof f === 'string' ? { rootId: primaryRoot, relativePath: f } : f));

  return {
    sessionId,
    workspaceRoot,
    workspace: {
      primaryRoot,
      additionalRoots,
    },
    model: typeof state.model === 'string' && state.model ? state.model : 'default',
    agentMode: state.agentMode === 'chat-only' ? 'chat-only' : 'agent',
    objective: typeof state.objective === 'string' ? state.objective : '',
    status: typeof state.status === 'string' ? (state.status as AgentState['status']) : 'idle',
    mode,
    title: typeof state.title === 'string' ? state.title : undefined,
    parentSessionId: typeof state.parentSessionId === 'string' ? state.parentSessionId : undefined,
    messages: array(state.messages) as AgentState['messages'],
    todos: array(state.todos) as AgentState['todos'],
    relevantFiles: array(state.relevantFiles) as AgentState['relevantFiles'],
    changedFiles: changedFiles as AgentState['changedFiles'],
    toolHistory: array(state.toolHistory) as AgentState['toolHistory'],
    tokenUsage: objectField(state.tokenUsage, (v) =>
      typeof v.prompt_tokens === 'number' &&
      typeof v.completion_tokens === 'number' &&
      typeof v.total_tokens === 'number'
    ) as AgentState['tokenUsage'],
    contextSummary: objectField(state.contextSummary, (v) =>
      typeof v.objective === 'string' && Array.isArray(v.completedWork)
    ) as AgentState['contextSummary'],
    modelProfile: objectField(state.modelProfile, (v) =>
      typeof v.id === 'string' && (v.mode === 'agent' || v.mode === 'chat-only')
    ) as AgentState['modelProfile'],
    checkpointIndex: numberField(state.checkpointIndex),
    checkpointCount: numberField(state.checkpointCount),
    canUndoCheckpoints: booleanField(state.canUndoCheckpoints),
    canRedoCheckpoints: booleanField(state.canRedoCheckpoints),
    plan: objectField(state.plan, (v) =>
      typeof v.summary === 'string' &&
      typeof v.filePath === 'string' &&
      typeof v.updatedAt === 'string' &&
      Array.isArray(v.steps)
    ) as AgentState['plan'],
    lastValidation: objectField(state.lastValidation, (v) =>
      typeof v.overallSuccess === 'boolean' &&
      Array.isArray(v.commands) &&
      typeof v.timestamp === 'string'
    ) as AgentState['lastValidation'],
    skillSummaries: array(state.skillSummaries) as AgentState['skillSummaries'],
    activeSkills: array(state.activeSkills) as AgentState['activeSkills'],
    subagentReports: array(state.subagentReports) as AgentState['subagentReports'],
  };
}
