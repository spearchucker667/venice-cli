import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mapEventToMessage } from './events.js';
import type { AgentEvent } from '../agent/events.js';

describe('mapEventToMessage', () => {
  it('maps session_started', () => {
    const event: AgentEvent = { type: 'session_started', timestamp: '', eventId: '1', sessionId: 's', objective: 'fix build' };
    const message = mapEventToMessage(event);
    assert.strictEqual(message?.role, 'event');
    assert.ok(message?.content.includes('fix build'));
  });

  it('maps tool_completed success', () => {
    const event: AgentEvent = {
      type: 'tool_completed',
      timestamp: '',
      eventId: '2',
      toolName: 'read_file',
      result: { ok: true, data: 'x' },
    };
    const message = mapEventToMessage(event);
    assert.strictEqual(message?.role, 'tool');
    assert.strictEqual(message?.metadata?.toolName, 'read_file');
    assert.strictEqual(message?.metadata?.ok, true);
  });

  it('maps tool_completed failure', () => {
    const event: AgentEvent = {
      type: 'tool_completed',
      timestamp: '',
      eventId: '3',
      toolName: 'shell',
      result: { ok: false, error: { message: 'exit 1' } },
    };
    const message = mapEventToMessage(event);
    assert.strictEqual(message?.metadata?.ok, false);
    assert.strictEqual(message?.metadata?.error, 'exit 1');
  });

  it('maps subagent events', () => {
    const started: AgentEvent = {
      type: 'subagent_started',
      timestamp: '',
      eventId: '4',
      kind: 'review',
      mode: 'read-only',
      task: 'Inspect auth',
      maxTurns: 6,
    };
    const completed: AgentEvent = {
      type: 'subagent_completed',
      timestamp: '',
      eventId: '5',
      kind: 'review',
      mode: 'read-only',
      status: 'complete',
      findings: 2,
      filesInspected: 4,
      changedFiles: 0,
    };
    assert.ok(mapEventToMessage(started)?.content.includes('subagent review'));
    assert.ok(mapEventToMessage(completed)?.content.includes('2 findings'));
  });

  it('returns undefined for unknown events', () => {
    const event = { type: 'unknown' } as unknown as AgentEvent;
    assert.strictEqual(mapEventToMessage(event), undefined);
  });
});
