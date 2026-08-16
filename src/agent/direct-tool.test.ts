import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AgentRuntime } from './runtime.js';
import { VeniceModelClient } from './model-client.js';
import { EventBus } from './events.js';
import type { ApprovalDecision } from './permissions.js';
import type { ModelResponse } from './model-client.js';
import type { AgentMessage } from './types.js';
import type { ToolDefinition } from '../types/index.js';

class NoopModelClient extends VeniceModelClient {
  async complete(_messages: AgentMessage[], _tools: ToolDefinition[] = []): Promise<ModelResponse> {
    return { content: 'done', finishReason: 'stop' };
  }

  async getModelContextLimit(): Promise<number> {
    return 128000;
  }

  async getModelProfile() {
    return undefined;
  }
}

describe('executeDirectTool (VC-KIMI-008)', () => {
  let tmp: string;

  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-direct-tool-')));
  });

  it('routes direct shell through runtime risk classification and approval', async () => {
    const events = new EventBus();
    const approvals: Array<{ toolName: string; input: unknown; risk: string }> = [];
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'test',
      approvalMode: 'suggest',
      modelClient: new NoopModelClient(),
      eventBus: events,
    });
    runtime.setApprovalCallback(async (toolName, input, risk) => {
      approvals.push({ toolName, input, risk });
      const decision: ApprovalDecision = { approved: true, scope: 'once' };
      return decision;
    });

    const result = await runtime.executeDirectTool('shell', { command: 'echo hi' }, { source: 'shell-mode' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.approved, true);
    assert.strictEqual(approvals.length, 1);
    assert.strictEqual(approvals[0].toolName, 'shell');
    assert.strictEqual(approvals[0].risk, 'execute');
    assert.ok(runtime.getState().toolHistory.some((t) => t.toolName === 'shell'), 'direct shell must be traced');
    assert.ok(
      events.events.some((e) => e.type === 'tool_completed' && e.toolName === 'shell'),
      'direct shell must emit tool_completed'
    );
  });

  it('denies without approval in suggest mode and records the denial', async () => {
    const events = new EventBus();
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'test',
      approvalMode: 'suggest',
      modelClient: new NoopModelClient(),
      eventBus: events,
    });
    runtime.setApprovalCallback(async () => ({ approved: false } as ApprovalDecision));

    const result = await runtime.executeDirectTool('shell', { command: 'echo hi' });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.approved, false);
    assert.strictEqual(result.error?.code, 'PERMISSION_DENIED');
    assert.ok(
      runtime.getState().toolHistory.some((t) => t.toolName === 'shell' && t.approved === false),
      'denied direct calls must be recorded'
    );
  });

  it('honors a session grant granted through direct execution', async () => {
    let approvalCalls = 0;
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'test',
      approvalMode: 'suggest',
      modelClient: new NoopModelClient(),
    });
    runtime.setApprovalCallback(async () => {
      approvalCalls++;
      return { approved: true, scope: 'session' } as ApprovalDecision;
    });

    await runtime.executeDirectTool('shell', { command: 'echo one' });
    const second = await runtime.executeDirectTool('shell', { command: 'echo two' });
    assert.strictEqual(second.approved, true);
    assert.strictEqual(approvalCalls, 1, 'second call should be auto-approved by the session grant');
  });

  it('does not let a session grant cover a higher-risk shell invocation', async () => {
    let approvalCalls = 0;
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'test',
      approvalMode: 'suggest',
      modelClient: new NoopModelClient(),
    });
    runtime.setApprovalCallback(async (_toolName, _input, risk) => {
      approvalCalls++;
      if (risk === 'external_side_effect') {
        // Second call (network command) requires a fresh approval.
        return { approved: true, scope: 'once' } as ApprovalDecision;
      }
      return { approved: true, scope: 'session' } as ApprovalDecision;
    });

    const local = await runtime.executeDirectTool('shell', { command: 'npm test' });
    assert.strictEqual(local.approved, true);
    const network = await runtime.executeDirectTool('shell', { command: 'curl https://example.com' });
    assert.strictEqual(network.approved, true);
    assert.strictEqual(approvalCalls, 2, 'network call must be re-approved despite the session grant');
  });

  it('auto-approves ordinary shell in yolo mode without an approver', async () => {
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'test',
      approvalMode: 'yolo',
      modelClient: new NoopModelClient(),
    });
    const result = await runtime.executeDirectTool('shell', { command: 'echo hi' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.approved, true);
  });

  it('still requires approval for destructive commands in yolo mode', async () => {
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'test',
      approvalMode: 'yolo',
      modelClient: new NoopModelClient(),
    });
    const result = await runtime.executeDirectTool('shell', { command: 'rm -rf /tmp/venice-never' });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error?.code, 'PERMISSION_DENIED');
  });

  it('returns an error for unknown tools', async () => {
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'test',
      approvalMode: 'yolo',
      modelClient: new NoopModelClient(),
    });
    const result = await runtime.executeDirectTool('definitely_not_a_tool', {});
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error?.code, 'UNKNOWN_TOOL');
  });
});
