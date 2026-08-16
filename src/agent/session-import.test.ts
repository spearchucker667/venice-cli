import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionImportService } from './session-import.js';
import { SessionManager, type StoredSession } from './sessions.js';
import type { AgentState } from './types.js';

function makeState(overrides: Partial<AgentState> = {}): AgentState {
  return {
    sessionId: 'imported-1',
    workspaceRoot: '/workspace',
    workspace: { primaryRoot: '/workspace', additionalRoots: [] },
    model: 'test',
    objective: 'imported objective',
    status: 'complete',
    mode: { inputMode: 'agent', operatingMode: 'agent', permissionMode: 'suggest' },
    messages: [{ role: 'user', content: 'hello' }],
    todos: [],
    relevantFiles: [],
    changedFiles: [],
    toolHistory: [],
    skillSummaries: [],
    activeSkills: [],
    ...overrides,
  };
}

function makeStored(overrides: Partial<StoredSession> = {}): StoredSession {
  return {
    schemaVersion: 2,
    sessionId: 'imported-1',
    state: makeState(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    events: [],
    ...overrides,
  };
}

describe('SessionImportService', () => {
  let tmp: string;
  let manager: SessionManager;

  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-import-test-')));
    manager = new SessionManager(path.join(tmp, 'sessions'));
  });

  it('persists an imported session so it can be resumed (VC-KIMI-011)', () => {
    const service = new SessionImportService(manager);
    const result = service.importData(makeStored());
    assert.strictEqual(result.importedAs, 'original');
    assert.strictEqual(result.sessionId, 'imported-1');

    const stored = manager.load('imported-1');
    assert.ok(stored, 'imported session must be saved before import returns');
    assert.strictEqual(stored!.state.objective, 'imported objective');
    assert.strictEqual(stored!.state.messages[0]?.content, 'hello');
  });

  it('rejects a collision unless --force is used', () => {
    const service = new SessionImportService(manager);
    assert.throws(() => service.importData(makeStored()), /already exists/);

    const forced = service.importData(makeStored({ state: makeState({ objective: 'overwritten' }) }), { force: true });
    assert.strictEqual(forced.sessionId, 'imported-1');
    assert.strictEqual(manager.load('imported-1')!.state.objective, 'overwritten');
  });

  it('imports under a new id with --fork and records the parent', () => {
    const service = new SessionImportService(manager);
    const result = service.importData(
      makeStored({ sessionId: 'fork-source', state: makeState({ sessionId: 'fork-source' }) }),
      { fork: true }
    );
    assert.strictEqual(result.importedAs, 'forked');
    assert.notStrictEqual(result.sessionId, 'fork-source');
    assert.strictEqual(result.state.parentSessionId, 'fork-source');
    assert.ok(manager.load(result.sessionId), 'forked import must be persisted');
  });

  it('rejects malformed or unsafe session data', () => {
    const service = new SessionImportService(manager);
    assert.throws(() => service.importData({} as StoredSession), /missing state/);
    assert.throws(
      () => service.importData(makeStored({ state: makeState({ sessionId: '../evil' }) })),
      /invalid sessionId/
    );
    assert.throws(
      () => service.importData(makeStored({ state: makeState({ sessionId: 'no-ws', workspaceRoot: '' }) })),
      /missing workspace/
    );
    assert.throws(
      () => service.importData(makeStored({ state: makeState({ sessionId: 'no-mode', mode: undefined as never }) })),
      /missing workspace or mode/
    );
  });

  it('imports from a JSON file written by the exporter', () => {
    const file = path.join(tmp, 'export.json');
    fs.writeFileSync(
      file,
      JSON.stringify(makeStored({ sessionId: 'file-import', state: makeState({ sessionId: 'file-import' }) }), null, 2)
    );
    const service = new SessionImportService(manager);
    const result = service.importFile(file);
    assert.strictEqual(result.sessionId, 'file-import');
    assert.ok(manager.load('file-import'));
  });

  it('reports missing files and malformed JSON', () => {
    const service = new SessionImportService(manager);
    assert.throws(() => service.importFile(path.join(tmp, 'nope.json')), /File not found/);
    const bad = path.join(tmp, 'bad.json');
    fs.writeFileSync(bad, '{ not json');
    assert.throws(() => service.importFile(bad), /Failed to parse session file/);
  });

  it('rejects future schema versions explicitly (VC-KIMI-062)', () => {
    const service = new SessionImportService(manager);
    assert.throws(
      () => service.importData(makeStored({ schemaVersion: 99 })),
      /Unsupported session schema version 99/
    );
  });

  it('rejects an identity mismatch between the stored id and the state id (VC-KIMI-061)', () => {
    const service = new SessionImportService(manager);
    assert.throws(
      () => service.importData(makeStored({ sessionId: 'top-level', state: makeState({ sessionId: 'inner-id' }) })),
      /does not match the stored state/
    );
  });

  it('repairs malformed arrays and defaults missing mode fields (VC-KIMI-061)', () => {
    const service = new SessionImportService(manager);
    const raw = makeStored({
      sessionId: 'repair-1',
      state: {
        ...makeState({ sessionId: 'repair-1' }),
        messages: 'not-an-array' as never,
        toolHistory: null as never,
        mode: { permissionMode: 'auto' } as never,
      },
    });
    const result = service.importData(raw);
    assert.deepStrictEqual(result.state.messages, []);
    assert.deepStrictEqual(result.state.toolHistory, []);
    assert.strictEqual(result.state.mode.permissionMode, 'auto');
    assert.strictEqual(result.state.mode.inputMode, 'agent');
  });
});
