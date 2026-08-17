import { describe, it } from 'node:test';
import assert from 'node:assert';
import { EventBus } from '../agent/events.js';
import { AgentRenderer } from './renderer.js';
import { toStreamJson } from '../agent/stream-json.js';

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

  it('prints the x402 balance for balance_remaining events', () => {
    const bus = new EventBus();
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (line?: unknown) => { lines.push(String(line)); };
    const renderer = new AgentRenderer({ eventBus: bus });
    renderer.start();

    try {
      bus.emit({
        type: 'balance_remaining',
        timestamp: new Date().toISOString(),
        eventId: 'b1',
        balanceUsd: 4.23,
      });
      assert.ok(lines.some((line) => /x402 credits remaining: \$4\.2300/.test(line)));
    } finally {
      console.log = originalLog;
      renderer.stop();
    }
  });

  it('maps balance_remaining into the stream-json protocol envelope', () => {
    const bus = new EventBus();
    const lines: string[] = [];
    const originalLog = console.log;
    console.log = (line?: unknown) => { lines.push(String(line)); };
    const renderer = new AgentRenderer({ eventBus: bus, outputFormat: 'stream-json' });
    renderer.start();

    try {
      bus.emit({ type: 'session_started', timestamp: new Date().toISOString(), eventId: 's1', sessionId: 'sid', objective: 'x' });
      bus.emit({
        type: 'balance_remaining',
        timestamp: new Date().toISOString(),
        eventId: 'b1',
        balanceUsd: 4.23,
        rateLimit: { remaining: 7 },
      });
      const parsed = lines.map((line) => JSON.parse(line));
      const balance = parsed.find((event) => event.type === 'balance.remaining');
      assert.ok(balance, 'stream-json must include balance.remaining');
      assert.equal(balance.data.balanceUsd, 4.23);
      assert.equal(balance.data.rateLimit.remaining, 7);
    } finally {
      console.log = originalLog;
      renderer.stop();
    }
  });

  it('maps balance_remaining via toStreamJson directly', () => {
    const event = toStreamJson(
      {
        type: 'balance_remaining',
        timestamp: new Date().toISOString(),
        eventId: 'b1',
        balanceUsd: 1.5,
      },
      { sessionId: 's', sequence: 1 }
    );
    assert.ok(event);
    assert.equal(event.type, 'balance.remaining');
  });
});
