import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AgentRuntime } from './runtime.js';

describe('session fork', () => {
  it('creates a new session with parent reference', () => {
    const runtime = new AgentRuntime({ workspaceRoot: process.cwd(), objective: 'fork test' });
    runtime.setTitle('My session');
    const forked = runtime.forkSession();
    assert.notStrictEqual(forked.sessionId, runtime.getState().sessionId);
    assert.strictEqual(forked.parentSessionId, runtime.getState().sessionId);
    assert.strictEqual(forked.title, 'My session (fork)');
  });

  it('sets title and emits title_changed event', () => {
    const runtime = new AgentRuntime({ workspaceRoot: process.cwd(), objective: 'title test' });
    runtime.setTitle('New title');
    assert.strictEqual(runtime.getState().title, 'New title');
  });
});
