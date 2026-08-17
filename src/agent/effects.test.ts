/**
 * Unit tests for the ToolEffect interpreter. The interpreter is the single
 * place the runtime applies tool-declared lifecycle effects, so it is tested
 * against injected services without a live runtime.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { interpretEffects, type ToolEffectServices } from './effects.js';
import type {
  AgentState,
  PlanArtifact,
  SubagentResult,
  UserQuestionResponse,
} from './types.js';
import type { AgentEvent } from './events.js';
import type { Skill } from '../skills/types.js';

function makeState(): AgentState {
  return {
    sessionId: 's1',
    workspaceRoot: '/ws',
    workspace: { primaryRoot: '/ws', additionalRoots: [] },
    model: 'mock',
    objective: 'test',
    status: 'idle',
    mode: { inputMode: 'agent', operatingMode: 'agent', permissionMode: 'suggest' },
    messages: [],
    todos: [],
    relevantFiles: [],
    changedFiles: [],
    toolHistory: [],
    skillSummaries: [],
    activeSkills: [],
    subagentReports: [],
  };
}

const skill: Skill = {
  name: 'known',
  description: 'A skill',
  tools: [],
  source: '/skills/known',
  content: 'body',
};

const plan: PlanArtifact = {
  summary: 'Do the thing',
  steps: [{ id: '1', text: 'First' }],
  filePath: '/ws/PLAN.md',
  updatedAt: '2026-08-17T00:00:00.000Z',
};

const report: SubagentResult = {
  mode: 'read-only',
  kind: 'review',
  task: 'Inspect',
  status: 'complete',
  summary: 'Clean',
  findings: [{ description: 'Minor' }],
  recommendations: ['Fix it'],
  filesInspected: ['/ws/a.ts'],
  changedFiles: [],
};

interface Harness {
  state: AgentState;
  events: AgentEvent[];
  services: ToolEffectServices;
  approval: (approved: boolean) => void;
  answer: (response: UserQuestionResponse | undefined) => void;
}

function makeHarness(signal?: AbortSignal): Harness {
  const state = makeState();
  const events: AgentEvent[] = [];
  let approval: (approved: boolean) => void = () => {};
  let answer: (response: UserQuestionResponse | undefined) => void = () => {};

  const services: ToolEffectServices = {
    state,
    context: {
      setActiveSkills(skills) {
        // Capture the effect for assertion via the state field it drives.
        (services as unknown as { active?: Skill[] }).active = skills;
      },
    },
    permissions: {
      requestPlanApproval: (_plan, sig) => {
        if (sig?.aborted) return Promise.resolve(false);
        return new Promise<boolean>((resolve) => { approval = resolve; });
      },
      requestUserAnswer: () => new Promise<UserQuestionResponse | undefined>((resolve) => { answer = resolve; }),
    },
    skills: {
      load(name) {
        return name === 'known' ? skill : undefined;
      },
    },
    events: { emit(event) { events.push(event); } },
    signal,
  };

  return {
    state,
    events,
    services,
    approval: (approved: boolean) => approval(approved),
    answer: (response: UserQuestionResponse | undefined) => answer(response),
  };
}

describe('ToolEffect interpreter', () => {
  it('setTodos replaces the todo list', async () => {
    const { state, services } = makeHarness();
    await interpretEffects([{ type: 'setTodos', todos: [{ id: 't', content: 'x', status: 'pending' }] }], services);
    assert.deepStrictEqual(state.todos, [{ id: 't', content: 'x', status: 'pending' }]);
  });

  it('activateSkill activates a skill once and loads its body', async () => {
    const { state, services } = makeHarness();
    await interpretEffects([
      { type: 'activateSkill', name: 'known' },
      { type: 'activateSkill', name: 'known' },
    ], services);
    assert.deepStrictEqual(state.activeSkills, ['known']);
    assert.deepStrictEqual((services as unknown as { active?: Skill[] }).active, [skill]);
  });

  it('recordSubagentReport records the report and emits subagent_completed', async () => {
    const { state, events, services } = makeHarness();
    await interpretEffects([{ type: 'recordSubagentReport', report }], services);
    assert.strictEqual(state.subagentReports?.length, 1);
    const event = events.find((e) => e.type === 'subagent_completed');
    assert.ok(event);
    if (event.type === 'subagent_completed') {
      assert.strictEqual(event.kind, 'review');
      assert.strictEqual(event.findings, 1);
      assert.strictEqual(event.filesInspected, 1);
    }
  });

  it('setPlan stores the plan and emits plan_updated', async () => {
    const { state, events, services } = makeHarness();
    await interpretEffects([{ type: 'setPlan', plan }], services);
    assert.strictEqual(state.plan, plan);
    assert.ok(events.some((e) => e.type === 'plan_updated'));
  });

  it('enterPlanMode is idempotent and emits mode_changed', async () => {
    const { state, events, services } = makeHarness();
    await interpretEffects([{ type: 'enterPlanMode' }, { type: 'enterPlanMode' }], services);
    assert.strictEqual(state.mode.operatingMode, 'plan');
    assert.strictEqual(events.filter((e) => e.type === 'mode_changed').length, 1);
  });

  it('leavePlanMode returns to agent mode', async () => {
    const { state, services } = makeHarness();
    state.mode.operatingMode = 'plan';
    await interpretEffects([{ type: 'leavePlanMode' }], services);
    assert.strictEqual(state.mode.operatingMode, 'agent');
  });

  it('subagentStarted emits the pre-execution event', async () => {
    const { events, services } = makeHarness();
    await interpretEffects([{ type: 'subagentStarted', kind: 'test', mode: 'write', task: 'Run', maxTurns: 4 }], services);
    const event = events.find((e) => e.type === 'subagent_started');
    assert.ok(event);
    if (event.type === 'subagent_started') {
      assert.strictEqual(event.kind, 'test');
      assert.strictEqual(event.maxTurns, 4);
    }
  });

  it('exitPlanMode exits on approval and leaves the result untouched', async () => {
    const { state, events, services, approval } = makeHarness();
    state.mode.operatingMode = 'plan';
    const interpreting = interpretEffects([{ type: 'exitPlanMode', plan }], services);
    approval(true);
    const outcome = await interpreting;
    assert.strictEqual(outcome.resultOverride, undefined);
    assert.strictEqual(state.mode.operatingMode, 'agent');
    assert.ok(events.some((e) => e.type === 'plan_exit_approved'));
  });

  it('exitPlanMode denial rewrites the result with PLAN_EXIT_DENIED', async () => {
    const { events, services, approval } = makeHarness();
    const interpreting = interpretEffects([{ type: 'exitPlanMode', plan }], services);
    approval(false);
    const outcome = await interpreting;
    assert.strictEqual(outcome.resultOverride?.ok, false);
    assert.strictEqual(outcome.resultOverride?.error?.code, 'PLAN_EXIT_DENIED');
    assert.ok(events.some((e) => e.type === 'plan_exit_denied'));
  });

  it('exitPlanMode cancellation sets status and rewrites the result', async () => {
    const controller = new AbortController();
    const { state, services, approval } = makeHarness(controller.signal);
    const interpreting = interpretEffects([{ type: 'exitPlanMode', plan }], services);
    controller.abort();
    approval(false); // late approval resolution after the turn is cancelled
    const outcome = await interpreting;
    assert.strictEqual(outcome.resultOverride?.error?.code, 'CANCELLED');
    assert.strictEqual(state.status, 'cancelled');
  });

  it('askUser without a collector rewrites the result to INTERACTION_REQUIRED', async () => {
    const { events, services, answer } = makeHarness();
    const interpreting = interpretEffects([{ type: 'askUser', question: 'Q?', options: ['A'] }], services);
    answer(undefined);
    const outcome = await interpreting;
    assert.strictEqual(outcome.resultOverride?.ok, false);
    assert.strictEqual(outcome.resultOverride?.error?.code, 'INTERACTION_REQUIRED');
    assert.ok(events.some((e) => e.type === 'user_question_requested'));
  });

  it('askUser with a collector rewrites the result with the answers', async () => {
    const { services, answer } = makeHarness();
    const interpreting = interpretEffects([{ type: 'askUser', question: 'Q?', multiSelect: true }], services);
    answer({ id: 'r1', answers: ['yes', 'no'] });
    const outcome = await interpreting;
    assert.strictEqual(outcome.resultOverride?.ok, true);
    const data = outcome.resultOverride?.data as { answers: string[]; multiSelect: boolean };
    assert.deepStrictEqual(data.answers, ['yes', 'no']);
    assert.strictEqual(data.multiSelect, true);
  });
});
