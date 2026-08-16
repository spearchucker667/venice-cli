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

  it('maps plan lifecycle events', () => {
    const plan = {
      summary: 'Refactor auth',
      steps: [{ id: '1', text: 'Centralize headers' }],
      filePath: '/ws/PLAN.md',
      updatedAt: '2026-08-16T00:00:00Z',
    };
    const updated: AgentEvent = {
      type: 'plan_updated',
      timestamp: '2026-08-16T00:00:00Z',
      eventId: '9',
      plan,
    };
    const requested: AgentEvent = {
      type: 'plan_exit_requested',
      timestamp: '2026-08-16T00:00:00Z',
      eventId: '10',
      plan,
    };
    assert.strictEqual(toStreamJson(updated)?.type, 'plan.updated');
    assert.strictEqual(toStreamJson(requested)?.type, 'plan.exit.requested');
    assert.strictEqual((toStreamJson(updated) as { plan?: unknown }).plan, plan);
  });

  it('maps queued/injected message events (VC-KIMI-053)', () => {
    const queued: AgentEvent = {
      type: 'message_queued',
      timestamp: '2026-08-16T00:00:00Z',
      eventId: '11',
      content: 'next',
      queueLength: 2,
    };
    const consumed: AgentEvent = {
      type: 'message_queued_consumed',
      timestamp: '2026-08-16T00:00:00Z',
      eventId: '12',
      content: 'next',
      remaining: 1,
    };
    const injected: AgentEvent = {
      type: 'message_injected',
      timestamp: '2026-08-16T00:00:00Z',
      eventId: '13',
      content: 'note',
    };
    assert.strictEqual(toStreamJson(queued)?.type, 'message.queued');
    assert.strictEqual(toStreamJson(consumed)?.type, 'message.queued_consumed');
    assert.strictEqual(toStreamJson(injected)?.type, 'message.injected');
  });

  it('maps a user-question interaction request (VC-KIMI-058)', () => {
    const event: AgentEvent = {
      type: 'user_question_requested',
      timestamp: '2026-08-16T00:00:00Z',
      eventId: '14',
      request: { id: 'q1', questions: [{ prompt: 'Which?', options: ['A', 'B'] }] },
    };
    const out = toStreamJson(event);
    assert.strictEqual(out?.type, 'user.question_requested');
    assert.deepStrictEqual((out as { request?: unknown }).request, event.request);
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
