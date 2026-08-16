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
    model: 'test',
    objective: 'test',
    status: 'idle',
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

  it('returns undefined for missing session', () => {
    assert.strictEqual(manager.load('missing'), undefined);
  });
});
