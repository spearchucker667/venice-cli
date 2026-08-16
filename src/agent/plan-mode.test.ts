import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AgentRuntime } from './runtime.js';
import { defaultMode } from './mode.js';
import { createDefaultRegistry } from '../tools/registry.js';
import { SessionManager } from './sessions.js';
import { VeniceModelClient } from './model-client.js';
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

describe('plan mode', () => {
  it('filters write tools from model definitions', () => {
    const runtime = new AgentRuntime({
      workspaceRoot: process.cwd(),
      objective: 'plan test',
      mode: { ...defaultMode(), operatingMode: 'plan' },
    });
    const defs = runtime.getToolDefinitions();
    const names = defs.map((d) => d.function.name);
    assert.ok(!names.includes('write_file'), 'write_file should be excluded');
    assert.ok(!names.includes('shell'), 'shell should be excluded');
    assert.ok(!names.includes('spawn_agent'), 'spawn_agent should be excluded');
    assert.ok(names.includes('read_file'), 'read_file should be included');
    assert.ok(names.includes('glob'), 'glob should be included');
  });

  it('can toggle plan mode at runtime', () => {
    const runtime = new AgentRuntime({
      workspaceRoot: process.cwd(),
      objective: 'plan test',
    });
    assert.strictEqual(runtime.getMode().operatingMode, 'agent');
    runtime.setMode({ operatingMode: 'plan' });
    assert.strictEqual(runtime.getMode().operatingMode, 'plan');
    assert.ok(!runtime.getToolDefinitions().some((d) => d.function.name === 'shell'));
  });

  it('exposes only explicitly plan-safe tools (VC-KIMI-069)', () => {
    const names = createDefaultRegistry().definitions('plan').map((d) => d.function.name);
    for (const safe of ['read_file', 'grep', 'glob', 'git_status', 'checkpoint_list']) {
      assert.ok(names.includes(safe), `${safe} should be plan-safe`);
    }
    for (const unsafe of ['write_file', 'shell', 'checkpoint_undo', 'checkpoint_redo', 'todo_write']) {
      assert.ok(!names.includes(unsafe), `${unsafe} must not appear in plan mode (VC-KIMI-006)`);
    }
  });

  it('allows normal user prompts in plan mode (VC-KIMI-005)', async () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-plan-prompt-')));
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'plan test',
      mode: { ...defaultMode('yolo'), operatingMode: 'plan' },
      modelClient: new NoopModelClient(),
      maxTurns: 3,
    });
    const finalMessage = await runtime.sendUserMessage('Draft a plan to refactor the auth module');
    assert.strictEqual(runtime.getState().status, 'complete');
    assert.ok(finalMessage.length >= 0);
  });

  it('denies a forged non-plan-safe tool call at the execution boundary (VC-KIMI-007)', async () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-plan-gate-')));
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'plan test',
      // Even yolo cannot bypass the plan gate: the persisted mode carries
      // both operatingMode and permissionMode (single authority).
      mode: { ...defaultMode('yolo'), operatingMode: 'plan' },
      modelClient: new NoopModelClient(),
    });

    const write = await runtime.executeDirectTool('write_file', { path: 'x.txt', content: 'nope' });
    assert.strictEqual(write.ok, false);
    assert.strictEqual(write.error?.code, 'PLAN_MODE_DENIED');
    assert.ok(!fs.existsSync(path.join(tmp, 'x.txt')), 'plan mode must not write files');

    const undo = await runtime.executeDirectTool('checkpoint_undo', {});
    assert.strictEqual(undo.error?.code, 'PLAN_MODE_DENIED', 'checkpoint undo is a mutating loophole');

    const redo = await runtime.executeDirectTool('checkpoint_redo', {});
    assert.strictEqual(redo.error?.code, 'PLAN_MODE_DENIED', 'checkpoint redo is a mutating loophole');

    fs.writeFileSync(path.join(tmp, 'notes.txt'), 'plan notes');
    const read = await runtime.executeDirectTool('read_file', { path: 'notes.txt' });
    assert.strictEqual(read.error, undefined, 'plan-safe reads still work');
  });
});

describe('plan artifact lifecycle', () => {
  let tmp: string;

  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-plan-artifact-')));
  });

  function planRuntime(): AgentRuntime {
    return new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'plan test',
      mode: { ...defaultMode('yolo'), operatingMode: 'plan' },
      modelClient: new NoopModelClient(),
    });
  }

  it('write_plan writes the artifact, syncs state, and emits plan_updated', async () => {
    const runtime = planRuntime();
    const result = await runtime.executeDirectTool('write_plan', {
      summary: 'Refactor auth',
      steps: ['Centralize auth headers', 'Add x402 regression tests'],
    });
    assert.strictEqual(result.ok, true);

    const plan = runtime.getState().plan;
    assert.ok(plan, 'state.plan must be synced');
    assert.strictEqual(plan!.summary, 'Refactor auth');
    assert.strictEqual(plan!.steps.length, 2);
    assert.ok(plan!.filePath.endsWith('PLAN.md'));

    const markdown = fs.readFileSync(path.join(tmp, 'PLAN.md'), 'utf-8');
    assert.ok(markdown.includes('Centralize auth headers'));
    assert.ok(runtime.getState().changedFiles.includes('PLAN.md'));
  });

  it('write_plan locks the plan file path after the first write', async () => {
    const runtime = planRuntime();
    await runtime.executeDirectTool('write_plan', { summary: 'S', steps: ['a'] });
    const second = await runtime.executeDirectTool('write_plan', {
      summary: 'S2',
      steps: ['b'],
      filePath: 'notes.md',
    });
    assert.strictEqual(second.ok, false);
    assert.strictEqual(second.error?.code, 'PLAN_FILE_LOCKED');
  });

  it('write_plan rejects paths outside the workspace', async () => {
    const runtime = planRuntime();
    const result = await runtime.executeDirectTool('write_plan', {
      summary: 'S',
      steps: ['a'],
      filePath: '../escape.md',
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error?.code, 'PLAN_FILE_OUTSIDE_WORKSPACE');
  });

  it('enter_plan_mode switches the operating mode', async () => {
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'test',
      approvalMode: 'yolo',
      modelClient: new NoopModelClient(),
    });
    const result = await runtime.executeDirectTool('enter_plan_mode', {});
    assert.strictEqual(result.ok, true);
    assert.strictEqual(runtime.getMode().operatingMode, 'plan');
  });

  it('exit_plan_mode with a plan requires approval even in yolo mode', async () => {
    const runtime = planRuntime();
    await runtime.executeDirectTool('write_plan', { summary: 'S', steps: ['a'] });

    // No approver installed => fails closed, stays in plan mode.
    const denied = await runtime.executeDirectTool('exit_plan_mode', {});
    assert.strictEqual(denied.ok, false);
    assert.strictEqual(denied.error?.code, 'PLAN_EXIT_DENIED');
    assert.strictEqual(runtime.getMode().operatingMode, 'plan', 'must stay in plan mode when not approved');

    // Approval granted => exits plan mode.
    runtime.setPlanApprover(async () => true);
    const approved = await runtime.executeDirectTool('exit_plan_mode', {});
    assert.strictEqual(approved.ok, true);
    assert.strictEqual(runtime.getMode().operatingMode, 'agent');
  });

  it('exit_plan_mode rejection keeps the plan intact for revision', async () => {
    const runtime = planRuntime();
    await runtime.executeDirectTool('write_plan', { summary: 'S', steps: ['a'] });
    runtime.setPlanApprover(async () => false);
    const result = await runtime.executeDirectTool('exit_plan_mode', {});
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error?.code, 'PLAN_EXIT_DENIED');
    assert.strictEqual(runtime.getMode().operatingMode, 'plan');
    assert.ok(runtime.getState().plan, 'plan must survive a rejected exit');
  });

  it('exit_plan_mode without a plan exits without approval', async () => {
    const runtime = planRuntime();
    const result = await runtime.executeDirectTool('exit_plan_mode', {});
    assert.strictEqual(result.ok, true);
    assert.strictEqual(runtime.getMode().operatingMode, 'agent');
  });

  it('clearPlan removes state and the plan file', async () => {
    const runtime = planRuntime();
    await runtime.executeDirectTool('write_plan', { summary: 'S', steps: ['a'] });
    assert.ok(fs.existsSync(path.join(tmp, 'PLAN.md')));
    runtime.clearPlan();
    assert.strictEqual(runtime.getState().plan, undefined);
    assert.ok(!fs.existsSync(path.join(tmp, 'PLAN.md')), 'plan file must be removed');
  });

  it('persists the plan with the session', async () => {
    const runtime = planRuntime();
    await runtime.executeDirectTool('write_plan', { summary: 'Persisted plan', steps: ['a'] });
    const manager = new SessionManager(path.join(tmp, 'sessions'));
    manager.save(runtime.getState(), []);
    const stored = manager.load(runtime.getState().sessionId, tmp);
    assert.ok(stored?.state.plan, 'plan must survive save/load');
    assert.strictEqual(stored!.state.plan!.summary, 'Persisted plan');
  });
});
