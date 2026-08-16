import { describe, it } from 'node:test';
import assert from 'node:assert';
import { toStreamJson } from '../agent/stream-json.js';
import type { AgentEvent } from '../agent/events.js';

describe('stream-json protocol', () => {
  it('maps session_started to session.started', () => {
    const event: AgentEvent = {
      type: 'session_started',
      timestamp: '2026-08-16T00:00:00Z',
      eventId: '1',
      sessionId: 's1',
      objective: 'test',
    };
    const out = toStreamJson(event);
    assert.strictEqual(out?.type, 'session.started');
    assert.strictEqual(out?.schemaVersion, '2026-08-16');
    assert.strictEqual(out?.sessionId, 's1');
  });

  it('maps assistant_delta to assistant.message', () => {
    const event: AgentEvent = {
      type: 'assistant_delta',
      timestamp: '2026-08-16T00:00:00Z',
      eventId: '2',
      content: 'hello',
    };
    const out = toStreamJson(event);
    assert.strictEqual(out?.type, 'assistant.message');
    assert.strictEqual(out?.content, 'hello');
  });

  it('maps tool_requested and tool_completed', () => {
    const requested: AgentEvent = {
      type: 'tool_requested',
      timestamp: '2026-08-16T00:00:00Z',
      eventId: '3',
      toolName: 'read_file',
      input: { path: 'x.txt' },
    };
    const completed: AgentEvent = {
      type: 'tool_completed',
      timestamp: '2026-08-16T00:00:01Z',
      eventId: '4',
      toolCallId: '3',
      toolName: 'read_file',
      result: { ok: true, data: 'content' },
    };
    assert.strictEqual(toStreamJson(requested)?.type, 'tool.requested');
    assert.strictEqual(toStreamJson(completed)?.type, 'tool.completed');
  });

  it('returns undefined for unmapped event types', () => {
    const event: AgentEvent = {
      type: 'model_request',
      timestamp: '2026-08-16T00:00:00Z',
      eventId: '5',
      messageCount: 1,
    };
    assert.strictEqual(toStreamJson(event), undefined);
  });
});
