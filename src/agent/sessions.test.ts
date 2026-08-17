import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionManager } from './sessions.js';
import type { AgentState } from './types.js';
import type { AgentEvent } from './events.js';

describe('SessionManager', () => {
  let tmp: string;
  let manager: SessionManager;

  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-sessions-test-')));
    manager = new SessionManager(tmp);
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const state = (id: string): AgentState => ({
    sessionId: id,
    workspaceRoot: '/tmp',
    workspace: { primaryRoot: '/tmp', additionalRoots: [] },
    model: 'test',
    objective: 'test',
    status: 'idle',
    mode: { inputMode: 'agent', operatingMode: 'agent', permissionMode: 'suggest' },
    messages: [{ role: 'user', content: 'hello' }],
    todos: [],
    relevantFiles: [],
    changedFiles: [],
    toolHistory: [],
    skillSummaries: [],
    activeSkills: [],
  });

  it('saves and loads a session', () => {
    const events: AgentEvent[] = [{ type: 'session_started', timestamp: new Date().toISOString(), eventId: '1', sessionId: 's1', objective: 'test' }];
    manager.save(state('s1'), events);
    const loaded = manager.load('s1');
    assert.ok(loaded);
    assert.strictEqual(loaded!.state.sessionId, 's1');
    assert.strictEqual(loaded!.events.length, 1);
  });

  it('lists sessions by recency', () => {
    manager.save(state('s2'), []);
    const list = manager.list();
    assert.ok(list.some((s) => s.sessionId === 's2'));
  });

  it('filters load and list operations by canonical workspace', () => {
    manager.save(state('workspace-session'), []);
    assert.strictEqual(manager.list('/tmp').some((s) => s.sessionId === 'workspace-session'), true);
    assert.strictEqual(manager.list('/different-workspace').some((s) => s.sessionId === 'workspace-session'), false);
    assert.ok(manager.load('workspace-session', '/tmp'));
    assert.strictEqual(manager.load('workspace-session', '/different-workspace'), undefined);
  });

  it('deletes a session', () => {
    manager.save(state('s3'), []);
    assert.strictEqual(manager.delete('s3'), true);
    assert.strictEqual(manager.load('s3'), undefined);
  });

  it('refuses to delete a session from a different workspace (VCL-037)', () => {
    const otherRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-other-ws-')));
    const foreign = state('cross-workspace-delete');
    foreign.workspaceRoot = otherRoot;
    foreign.workspace = { primaryRoot: otherRoot, additionalRoots: [] };
    manager.save(foreign, []);

    // A caller scoped to the current workspace must not delete it.
    assert.strictEqual(manager.delete('cross-workspace-delete', tmp), false);
    assert.ok(manager.load('cross-workspace-delete'), 'session must survive the cross-workspace denial');

    // Scoped to its own workspace, deletion succeeds.
    assert.strictEqual(manager.delete('cross-workspace-delete', otherRoot), true);
    fs.rmSync(otherRoot, { recursive: true, force: true });
  });

  it('returns undefined for missing session', () => {
    assert.strictEqual(manager.load('missing'), undefined);
  });

  it('returns undefined for corrupt canonical session JSON', () => {
    const dir = path.join(tmp, 'corrupt');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'session.json'), '{not-json');
    assert.strictEqual(manager.load('corrupt'), undefined);
    assert.doesNotThrow(() => manager.list());
  });

  it('removes stale temporary files on the next save', () => {
    const dir = path.join(tmp, 'stale-temp');
    fs.mkdirSync(dir, { recursive: true });
    const stale = path.join(dir, 'session.json.tmp.stale');
    fs.writeFileSync(stale, 'partial');
    const old = new Date(Date.now() - 10 * 60 * 1000);
    fs.utimesSync(stale, old, old);
    manager.save(state('stale-temp'), []);
    assert.strictEqual(fs.existsSync(stale), false);
    assert.ok(manager.load('stale-temp'));
  });

  it('rejects session IDs that could escape the session root', () => {
    assert.strictEqual(manager.load('../../outside'), undefined);
    assert.throws(() => manager.save(state('../outside'), []), /Invalid session ID/);
    assert.strictEqual(manager.delete('/tmp/outside'), false);
  });

  it('keeps the previous canonical generation when rename fails', () => {
    const original = state('rename-failure');
    manager.save(original, []);
    const failing = new SessionManager(tmp, {
      writeFileSync: fs.writeFileSync,
      openSync: fs.openSync,
      fsyncSync: fs.fsyncSync,
      closeSync: fs.closeSync,
      unlinkSync: fs.unlinkSync,
      renameSync: (source, destination) => {
        if (String(destination).endsWith('session.json')) throw new Error('simulated rename failure');
        fs.renameSync(source, destination);
      },
    });
    const updated = { ...original, objective: 'must not become visible' };
    assert.throws(() => failing.save(updated, []), /simulated rename failure/);
    assert.strictEqual(manager.load('rename-failure')?.state.objective, 'test');
    assert.strictEqual(fs.readdirSync(path.join(tmp, 'rename-failure')).some((name) => name.includes('.tmp.')), false);
  });

  it('loads state and events from the same canonical generation', () => {
    const restored = state('restore-all');
    restored.model = 'restored-model';
    restored.changedFiles = [{ rootId: '/tmp', relativePath: 'src/a.ts' }];
    restored.activeSkills = ['review'];
    restored.checkpointIndex = 2;
    restored.checkpointCount = 3;
    const events: AgentEvent[] = [{
      type: 'session_started', timestamp: new Date().toISOString(), eventId: 'generation-event',
      sessionId: restored.sessionId, objective: restored.objective,
    }];
    manager.save(restored, events);
    fs.writeFileSync(path.join(tmp, 'restore-all', 'events.jsonl'), '{corrupt projection}\n');
    const loaded = manager.load('restore-all');
    assert.strictEqual(loaded?.state.model, 'restored-model');
    assert.deepEqual(loaded?.state.changedFiles, [{ rootId: '/tmp', relativePath: 'src/a.ts' }]);
    assert.deepEqual(loaded?.state.activeSkills, ['review']);
    assert.strictEqual(loaded?.state.checkpointIndex, 2);
    assert.strictEqual(loaded?.events[0].eventId, 'generation-event');
  });
});
