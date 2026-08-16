import { describe, it } from 'node:test';
import assert from 'node:assert';
import { EventBus } from '../agent/events.js';
import { AgentRenderer } from './renderer.js';

describe('AgentRenderer', () => {
  it('subscribes to events', () => {
    const bus = new EventBus();
    const renderer = new AgentRenderer({ eventBus: bus });
    renderer.start();

    let called = false;
    bus.on(() => { called = true; });
    bus.emit({ type: 'session_started', timestamp: new Date().toISOString(), eventId: '1', sessionId: 's1', objective: 'test' });

    assert.strictEqual(called, true);
    renderer.stop();
  });
});
