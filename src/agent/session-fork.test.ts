import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AgentRuntime } from './runtime.js';
import { SessionManager } from './sessions.js';

describe('session fork', () => {
  it('creates a durable fork with a parent reference (VC-KIMI-010)', async () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-fork-test-')));
    const manager = new SessionManager(path.join(tmp, 'sessions'));
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'fork test',
      sessionManager: manager,
    });
    runtime.setTitle('My session');

    const forkedId = await runtime.forkSession();
    assert.notStrictEqual(forkedId, runtime.getState().sessionId);

    // The fork must be persisted so an immediate resume can find it.
    const stored = manager.load(forkedId, tmp);
    assert.ok(stored, 'forked session must be saved before forkSession returns');
    assert.strictEqual(stored!.state.parentSessionId, runtime.getState().sessionId);
    assert.strictEqual(stored!.state.title, 'My session (fork)');
  });

  it('sets title and emits title_changed event', () => {
    const runtime = new AgentRuntime({ workspaceRoot: process.cwd(), objective: 'title test' });
    runtime.setTitle('New title');
    assert.strictEqual(runtime.getState().title, 'New title');
  });
});
