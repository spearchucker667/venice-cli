import { describe, it } from 'node:test';
import assert from 'node:assert';
import { toStreamJson, serializeStreamJson, PROTOCOL_SCHEMA_VERSION } from '../agent/stream-json.js';
import type { AgentEvent } from '../agent/events.js';

const ctx = { sessionId: 's1', sequence: 0, turnId: 't1' };

describe('stream-json protocol (VCL-R3-011)', () => {
  it('wraps every mapped event in the AgentProtocolEvent envelope', () => {
    const event: AgentEvent = {
      type: 'session_started',
      timestamp: '2026-08-16T00:00:00Z',
      eventId: '1',
      sessionId: 's1',
      objective: 'test',
    };
    const out = toStreamJson(event, ctx);
    assert.strictEqual(out?.type, 'session.started');
    assert.strictEqual(out?.schemaVersion, PROTOCOL_SCHEMA_VERSION);
    assert.strictEqual(out?.schemaVersion, 2);
    assert.strictEqual(out?.sequence, 0);
    assert.strictEqual(out?.eventId, '1');
    assert.strictEqual(out?.sessionId, 's1');
    assert.strictEqual(out?.turnId, 't1');
    assert.strictEqual(out?.timestamp, '2026-08-16T00:00:00Z');
    assert.deepStrictEqual(out?.data, { objective: 'test' });
  });

  it('maps assistant_delta to assistant.message with content in data', () => {
    const event: AgentEvent = {
      type: 'assistant_delta',
      timestamp: '2026-08-16T00:00:00Z',
      eventId: '2',
      content: 'hello',
    };
    const out = toStreamJson(event, ctx);
    assert.strictEqual(out?.type, 'assistant.message');
    assert.deepStrictEqual(out?.data, { content: 'hello' });
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
    const requestedOut = toStreamJson(requested, ctx);
    const completedOut = toStreamJson(completed, ctx);
    assert.strictEqual(requestedOut?.type, 'tool.requested');
    assert.deepStrictEqual(requestedOut?.data, { tool: 'read_file', input: { path: 'x.txt' } });
    assert.strictEqual(completedOut?.type, 'tool.completed');
    assert.deepStrictEqual(completedOut?.data, { tool: 'read_file', result: { ok: true, data: 'content' } });
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
    assert.strictEqual(toStreamJson(updated, ctx)?.type, 'plan.updated');
    assert.strictEqual(toStreamJson(requested, ctx)?.type, 'plan.exit.requested');
    assert.deepStrictEqual(toStreamJson(updated, ctx)?.data, { plan });
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
    assert.strictEqual(toStreamJson(queued, ctx)?.type, 'message.queued');
    assert.strictEqual(toStreamJson(consumed, ctx)?.type, 'message.queued_consumed');
    assert.strictEqual(toStreamJson(injected, ctx)?.type, 'message.injected');
  });

  it('maps a user-question interaction request (VC-KIMI-058)', () => {
    const event: AgentEvent = {
      type: 'user_question_requested',
      timestamp: '2026-08-16T00:00:00Z',
      eventId: '14',
      request: { id: 'q1', questions: [{ prompt: 'Which?', options: ['A', 'B'] }] },
    };
    const out = toStreamJson(event, ctx);
    assert.strictEqual(out?.type, 'user.question_requested');
    assert.deepStrictEqual(out?.data, { request: event.request });
  });

  it('maps approval, validation, subagent, file-change, mode, MCP, and compaction events', () => {
    const cases: Array<[AgentEvent, string]> = [
      [{ type: 'approval_requested', timestamp: 't', eventId: 'a', toolName: 'shell', risk: 'execute' }, 'approval.requested'],
      [{ type: 'approval_granted', timestamp: 't', eventId: 'b', toolName: 'shell', scope: 'once' }, 'approval.granted'],
      [{ type: 'validation_started', timestamp: 't', eventId: 'c', command: 'npm test' }, 'validation.started'],
      [{ type: 'validation_completed', timestamp: 't', eventId: 'd', command: 'npm test', exitCode: 0 }, 'validation.completed'],
      [{ type: 'subagent_started', timestamp: 't', eventId: 'e', kind: 'review', mode: 'read-only', task: 'x', maxTurns: 5 }, 'subagent.started'],
      [{ type: 'file_changed', timestamp: 't', eventId: 'f', path: 'src/a.ts', operation: 'edit_file' }, 'file.changed'],
      [{ type: 'mode_changed', timestamp: 't', eventId: 'g', mode: { inputMode: 'agent', operatingMode: 'agent', permissionMode: 'suggest' } }, 'mode.changed'],
      [{ type: 'mcp_ready', timestamp: 't', eventId: 'h', servers: [{ name: 's', toolCount: 1 }] }, 'mcp.ready'],
      [{ type: 'mcp_failed', timestamp: 't', eventId: 'i', message: 'boom' }, 'mcp.failed'],
      [{ type: 'context_compacted', timestamp: 't', eventId: 'j', summary: { objective: 'o' } }, 'context.compacted'],
    ];
    for (const [event, expected] of cases) {
      assert.strictEqual(toStreamJson(event, ctx)?.type, expected);
    }
  });

  it('serializes to a single JSON line with the envelope fields intact', () => {
    const event: AgentEvent = {
      type: 'assistant_delta',
      timestamp: '2026-08-16T00:00:00Z',
      eventId: '2',
      content: 'hello',
    };
    const line = serializeStreamJson(toStreamJson(event, ctx)!);
    assert.strictEqual(line.includes('\n'), false);
    const parsed = JSON.parse(line);
    assert.strictEqual(parsed.schemaVersion, 2);
    assert.strictEqual(parsed.type, 'assistant.message');
    assert.deepStrictEqual(parsed.data, { content: 'hello' });
  });

  it('returns undefined for event types without a mapping', () => {
    const event: AgentEvent = {
      type: 'user_question_requested',
      timestamp: 't',
      eventId: 'x',
      request: { id: 'q', questions: [] },
    };
    // user_question_requested IS mapped; use a deliberately unmapped future type.
    const unmapped = { type: 'future_event', timestamp: 't', eventId: 'y' } as unknown as AgentEvent;
    assert.strictEqual(toStreamJson(unmapped, ctx), undefined);
    assert.ok(toStreamJson(event, ctx));
  });
});
