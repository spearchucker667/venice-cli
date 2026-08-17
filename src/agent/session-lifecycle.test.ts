import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AgentRuntime } from './runtime.js';
import { SessionManager } from './sessions.js';
import { VeniceModelClient } from './model-client.js';
import { EventBus } from './events.js';
import type { ModelResponse } from './model-client.js';
import type { AgentMessage, AgentState } from './types.js';
import type { ToolDefinition } from '../types/index.js';

class StubModelClient extends VeniceModelClient {
  constructor(private readonly content: string) {
    super({ model: 'mock' });
  }
  async complete(_messages: AgentMessage[], _tools: ToolDefinition[] = []): Promise<ModelResponse> {
    return { content: this.content, finishReason: 'stop' };
  }
  async getModelContextLimit(): Promise<number> {
    return 128000;
  }
  async getModelProfile() {
    return undefined;
  }
}

function userMessages(state: AgentState): string[] {
  return state.messages.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : ''));
}

describe('session resume lifecycle', () => {
  let tmp: string;
  let manager: SessionManager;

  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-resume-test-')));
    manager = new SessionManager(path.join(tmp, 'sessions'));
  });

  it('appends the new prompt instead of replaying the stored objective (VC-KIMI-003)', async () => {
    // First run: objective "first".
    const first = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'first',
      modelClient: new StubModelClient('done first'),
      sessionManager: manager,
      maxTurns: 3,
    });
    await first.run();
    const stored = manager.load(first.getState().sessionId, tmp);
    assert.ok(stored);

    // Resume with a new prompt: must be appended, never replayed.
    const resumed = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'second', // would be replayed by the old run() flow
      modelClient: new StubModelClient('done second'),
      sessionManager: manager,
      maxTurns: 3,
    });
    resumed.loadState(stored!.state);

    const result = await resumed.resumeAndSend('second');
    const users = userMessages(result.state);
    assert.deepStrictEqual(users, ['first', 'second'], 'new prompt appended, old objective not replayed');
    assert.strictEqual(result.state.objective, 'second');
    assert.strictEqual(result.state.status, 'complete');
  });

  it('emits a fresh session_completed on a resumed completed session (VC-KIMI-021)', async () => {
    const first = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'first complete',
      modelClient: new StubModelClient('done'),
      sessionManager: manager,
      maxTurns: 3,
    });
    await first.run();
    const stored = manager.load(first.getState().sessionId, tmp);
    assert.strictEqual(stored!.state.status, 'complete');

    const eventBus = new EventBus();
    const resumed = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'resume',
      modelClient: new StubModelClient('done again'),
      sessionManager: manager,
      eventBus: eventBus,
      maxTurns: 3,
    });
    resumed.loadState(stored!.state);
    await resumed.resumeAndSend('do more');

    const completions = eventBus.events.filter((e) => e.type === 'session_completed');
    assert.ok(completions.length >= 1, 'resumed run must emit a fresh session_completed');
    assert.strictEqual(completions.at(-1)?.type, 'session_completed');
  });

  it('applies explicit CLI mode overrides after stored state (stored suggest -> CLI auto)', async () => {
    const first = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'mode test',
      modelClient: new StubModelClient('done'),
      sessionManager: manager,
      maxTurns: 3,
    });
    await first.run();
    const stored = manager.load(first.getState().sessionId, tmp);
    assert.strictEqual(stored!.state.mode.permissionMode, 'suggest');

    // Without an override the stored mode wins.
    const plain = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'x',
      modelClient: new StubModelClient('done'),
      sessionManager: manager,
    });
    plain.loadState(stored!.state);
    assert.strictEqual(plain.getPermissionManager().getMode(), 'suggest');

    // With a CLI override, the explicit flag wins (VC-KIMI-004).
    const overridden = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'x',
      approvalMode: 'auto',
      modelClient: new StubModelClient('done'),
      sessionManager: manager,
    });
    overridden.loadState(stored!.state, { mode: { permissionMode: 'auto' } });
    assert.strictEqual(overridden.getMode().permissionMode, 'auto');
    assert.strictEqual(overridden.getPermissionManager().getMode(), 'auto');
  });

  it('resetSession fully resets session-owned metadata (VC-KIMI-026)', async () => {
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'old objective',
      approvalMode: 'yolo',
      modelClient: new StubModelClient('done'),
      sessionManager: manager,
    });
    runtime.setTitle('Old title');
    runtime.setPermissionMode('yolo');
    const originalId = runtime.getState().sessionId;

    runtime.resetSession();

    const state = runtime.getState();
    assert.notStrictEqual(state.sessionId, originalId);
    assert.strictEqual(state.title, undefined, 'title must reset');
    assert.strictEqual(state.parentSessionId, undefined, 'parent must reset');
    assert.strictEqual(state.objective, '', 'objective must reset');
    assert.strictEqual(state.plan, undefined, 'plan must reset');
    assert.strictEqual(state.messages.length, 0);
    assert.strictEqual(state.toolHistory.length, 0);
    assert.strictEqual(state.changedFiles.length, 0);
    assert.strictEqual(state.activeSkills.length, 0);
    assert.strictEqual(state.mode.operatingMode, 'agent');
    assert.strictEqual(state.mode.inputMode, 'agent');
    assert.strictEqual(state.mode.permissionMode, 'yolo', 'permission preference is retained');
  });

  it('surfaces persistence failures instead of swallowing them (VC-KIMI-022)', async () => {
    class FailingSessionManager extends SessionManager {
      override save(): void {
        throw new Error('disk full');
      }
    }
    const eventBus = new EventBus();
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'persist test',
      modelClient: new StubModelClient('done'),
      sessionManager: new FailingSessionManager(path.join(tmp, 'sessions-fail')),
      eventBus: eventBus,
      maxTurns: 3,
    });

    await runtime.run();
    assert.ok(
      eventBus.events.some((e) => e.type === 'session_persist_failed' && e.message.includes('disk full')),
      'persistence failure must be surfaced as an event'
    );
    assert.strictEqual(runtime.isPersistDirty(), true);
  });

  it('resetSession isolates queues, context summary, custom prompt, and grants (R2-003)', async () => {
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'prior objective',
      approvalMode: 'suggest',
      modelClient: new StubModelClient('done'),
      sessionManager: manager,
    });

    // Seed state, context layers, queues, and grants
    const systemText = () => String(runtime.getContextManager().buildMessages(runtime.getState())[0].content);
    runtime.getContextManager().compact({
      objective: 'prior objective',
      completedWork: ['did things'],
      remainingWork: [],
      decisions: [],
      discoveries: [],
      filesRead: [],
      filesChanged: [],
      commandsRun: [],
      failures: [],
      importantConstraints: [],
    });
    runtime.getContextManager().setAgentPrompt('custom system prompt');
    runtime.getPermissionManager().grant('session', 'edit_file', undefined, 'write');
    runtime.queueUserMessage('queued 1');

    assert.strictEqual(runtime.getQueuedMessageCount(), 1);
    assert.ok(systemText().includes('did things'), 'summary must be seeded');
    assert.ok(systemText().includes('custom system prompt'), 'agent prompt must be seeded');
    assert.strictEqual(await runtime.getPermissionManager().isApproved('edit_file', {}, 'write'), true);

    // Call resetSession
    runtime.resetSession();

    assert.strictEqual(runtime.getQueuedMessageCount(), 0, 'queued messages must be cleared');
    assert.ok(!systemText().includes('did things'), 'summary must be cleared');
    assert.ok(!systemText().includes('custom system prompt'), 'agent prompt must be cleared');
    assert.strictEqual(await runtime.getPermissionManager().isApproved('edit_file', {}, 'write'), false, 'grants must be cleared');
  });

  it('loadState isolates queues, context layers, and permission grants from prior session (R2-003)', async () => {
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'first session',
      approvalMode: 'suggest',
      modelClient: new StubModelClient('done'),
      sessionManager: manager,
    });

    runtime.getContextManager().compact({
      objective: 'old summary',
      completedWork: ['old completed work'],
      remainingWork: [],
      decisions: [],
      discoveries: [],
      filesRead: [],
      filesChanged: [],
      commandsRun: [],
      failures: [],
      importantConstraints: [],
    });
    runtime.getContextManager().setAgentPrompt('old agent prompt');
    runtime.getPermissionManager().grant('session', 'read_file', undefined, 'read');
    runtime.queueUserMessage('old queued message');

    const freshState: AgentState = {
      sessionId: 'fresh-id',
      workspaceRoot: tmp,
      workspace: { primaryRoot: tmp, additionalRoots: [] },
      model: 'mock',
      agentMode: 'agent',
      objective: 'resumed objective',
      status: 'idle',
      mode: { inputMode: 'agent', operatingMode: 'agent', permissionMode: 'suggest' },
      messages: [{ role: 'user', content: 'hello restored' }],
      todos: [],
      relevantFiles: [],
      changedFiles: [],
      toolHistory: [],
      skillSummaries: [],
      activeSkills: [],
      subagentReports: [],
    };

    runtime.loadState(freshState);

    assert.strictEqual(runtime.getState().sessionId, 'fresh-id');
    assert.strictEqual(runtime.getQueuedMessageCount(), 0, 'queues must not bleed across loadState');
    const systemText = String(runtime.getContextManager().buildMessages(runtime.getState())[0].content);
    assert.ok(!systemText.includes('old completed work'), 'summary must not bleed across loadState');
    assert.ok(!systemText.includes('old agent prompt'), 'agent prompt must not bleed across loadState');
    assert.strictEqual(runtime.getState().messages.length, 1);
  });
});
