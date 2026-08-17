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

  it('round-trips every durable field through export/import (VCL-R3-009)', () => {
    const durableState = makeState({
      sessionId: 'roundtrip-1',
      modelProfile: { id: 'venice/glm', mode: 'agent', supportsFunctionCalling: true, contextLimit: 128000 },
      tokenUsage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      contextSummary: {
        objective: 'roundtrip objective',
        completedWork: ['a'],
        remainingWork: ['b'],
        decisions: [],
        discoveries: [],
        filesRead: [],
        filesChanged: [],
        commandsRun: [{ command: 'npm test', result: 'pass' }],
        failures: [],
        importantConstraints: [],
      },
      checkpointIndex: 1,
      checkpointCount: 3,
      canUndoCheckpoints: true,
      canRedoCheckpoints: false,
      plan: {
        summary: 'Plan summary',
        steps: [{ id: '1', text: 'step one' }],
        filePath: '/workspace/PLAN.md',
        updatedAt: new Date().toISOString(),
      },
      lastValidation: {
        commands: [{ command: 'npm run build', exitCode: 0, stdout: 'ok', stderr: '' }],
        overallSuccess: true,
        timestamp: new Date().toISOString(),
      },
      title: 'My session',
    });

    // encode(state) is the JSON the exporter writes; decode is importData.
    const encoded = JSON.parse(JSON.stringify(makeStored({ sessionId: 'roundtrip-1', state: durableState })));
    const service = new SessionImportService(manager);
    const result = service.importData(encoded);

    assert.deepStrictEqual(result.state.modelProfile, durableState.modelProfile);
    assert.deepStrictEqual(result.state.tokenUsage, durableState.tokenUsage);
    assert.deepStrictEqual(result.state.contextSummary, durableState.contextSummary);
    assert.strictEqual(result.state.checkpointIndex, 1);
    assert.strictEqual(result.state.checkpointCount, 3);
    assert.strictEqual(result.state.canUndoCheckpoints, true);
    assert.strictEqual(result.state.canRedoCheckpoints, false);
    assert.deepStrictEqual(result.state.plan, durableState.plan);
    assert.deepStrictEqual(result.state.lastValidation, durableState.lastValidation);
    assert.strictEqual(result.state.title, 'My session');

    // And it survives persistence so a resumed runtime sees it all.
    const stored = manager.load('roundtrip-1');
    assert.deepStrictEqual(stored?.state.lastValidation, durableState.lastValidation);
    assert.deepStrictEqual(stored?.state.plan, durableState.plan);
    assert.deepStrictEqual(stored?.state.modelProfile, durableState.modelProfile);
  });

  it('drops malformed durable fields instead of crashing (VCL-R3-009)', () => {
    const service = new SessionImportService(manager);
    const raw = makeStored({
      sessionId: 'bad-durable-1',
      state: {
        ...makeState({ sessionId: 'bad-durable-1' }),
        modelProfile: { id: 42 } as never,
        tokenUsage: 'nope' as never,
        plan: { summary: 'no file path' } as never,
        lastValidation: { overallSuccess: 'yes' } as never,
        checkpointCount: 'three' as never,
      },
    });
    const result = service.importData(raw);
    assert.strictEqual(result.state.modelProfile, undefined);
    assert.strictEqual(result.state.tokenUsage, undefined);
    assert.strictEqual(result.state.plan, undefined);
    assert.strictEqual(result.state.lastValidation, undefined);
    assert.strictEqual(result.state.checkpointCount, undefined);
  });
});
