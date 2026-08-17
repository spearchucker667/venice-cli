/**
 * Tool lifecycle effects.
 *
 * Tools are pure: `execute` produces a result, and the result alone does not
 * decide how the agent state changes afterwards. A tool that needs the
 * runtime to react (plan mode, skills, todos, subagent reports, user
 * questions) declares that reaction as a list of `ToolEffect`s. The runtime
 * runs the single interpreter below, so lifecycle locality lives in the tool
 * module and the runtime never special-cases tool names.
 */

import { randomUUID } from 'node:crypto';
import type { AgentEvent } from './events.js';
import type {
  AgentState,
  PlanArtifact,
  SubagentKind,
  SubagentMode,
  SubagentResult,
  TodoItem,
  ToolResult,
  UserQuestionRequest,
  UserQuestionResponse,
} from './types.js';
import type { Skill } from '../skills/types.js';

/**
 * Declarative reaction a tool asks the runtime to apply after (or, for
 * `subagentStarted`, before) execution. The interpreter owns state mutation,
 * events, and any interactive awaits; tools stay pure and synchronous.
 */
export type ToolEffect =
  | { type: 'setTodos'; todos: TodoItem[] }
  | { type: 'activateSkill'; name: string }
  | { type: 'recordSubagentReport'; report: SubagentResult }
  | { type: 'setPlan'; plan: PlanArtifact }
  | { type: 'enterPlanMode' }
  | { type: 'leavePlanMode' }
  | { type: 'exitPlanMode'; plan: PlanArtifact }
  | { type: 'askUser'; question: string; options?: string[]; multiSelect?: boolean }
  | { type: 'subagentStarted'; kind: SubagentKind; mode: SubagentMode; task: string; maxTurns: number };

/** The runtime services the interpreter is allowed to touch. */
export interface ToolEffectServices {
  state: AgentState;
  context: { setActiveSkills(skills: Skill[]): void };
  permissions: {
    requestPlanApproval(plan: PlanArtifact, signal?: AbortSignal): Promise<boolean>;
    requestUserAnswer(request: UserQuestionRequest): Promise<UserQuestionResponse | undefined>;
  };
  skills: { load(name: string): Skill | undefined };
  events: { emit(event: AgentEvent): void };
  signal?: AbortSignal;
}

/** What the interpreter hands back after applying a tool's effects. */
export interface ToolEffectOutcome {
  /**
   * Interactive effects (`askUser`, `exitPlanMode`) rewrite the tool's own
   * result (an answer, or a denial/cancellation). Non-interactive effects
   * leave the tool result untouched.
   */
  resultOverride?: ToolResult<unknown>;
}

function timestamp(): string {
  return new Date().toISOString();
}

function setOperatingMode(services: ToolEffectServices, operatingMode: 'agent' | 'plan'): void {
  services.state.mode = { ...services.state.mode, operatingMode };
  services.events.emit({
    type: 'mode_changed',
    timestamp: timestamp(),
    eventId: randomUUID(),
    mode: services.state.mode,
  });
}

/**
 * Apply a tool's declared effects in order. Later interactive effects may
 * overwrite the outcome's `resultOverride`.
 */
export async function interpretEffects(
  effects: readonly ToolEffect[],
  services: ToolEffectServices
): Promise<ToolEffectOutcome> {
  const outcome: ToolEffectOutcome = {};
  for (const effect of effects) {
    switch (effect.type) {
      case 'setTodos': {
        services.state.todos = effect.todos;
        break;
      }
      case 'activateSkill': {
        if (!services.state.activeSkills.includes(effect.name)) {
          services.state.activeSkills.push(effect.name);
          services.context.setActiveSkills(
            services.state.activeSkills
              .map((name) => services.skills.load(name))
              .filter((skill): skill is Skill => skill !== undefined)
          );
        }
        break;
      }
      case 'recordSubagentReport': {
        services.state.subagentReports ||= [];
        services.state.subagentReports.push(effect.report);
        services.events.emit({
          type: 'subagent_completed',
          timestamp: timestamp(),
          eventId: randomUUID(),
          kind: effect.report.kind,
          mode: effect.report.mode,
          status: effect.report.status,
          findings: effect.report.findings.length,
          filesInspected: effect.report.filesInspected.length,
          changedFiles: effect.report.changedFiles?.length ?? 0,
        });
        break;
      }
      case 'setPlan': {
        services.state.plan = effect.plan;
        services.events.emit({
          type: 'plan_updated',
          timestamp: timestamp(),
          eventId: randomUUID(),
          plan: effect.plan,
        });
        break;
      }
      case 'enterPlanMode': {
        if (services.state.mode.operatingMode !== 'plan') {
          setOperatingMode(services, 'plan');
        }
        break;
      }
      case 'leavePlanMode': {
        setOperatingMode(services, 'agent');
        break;
      }
      case 'exitPlanMode': {
        services.events.emit({
          type: 'plan_exit_requested',
          timestamp: timestamp(),
          eventId: randomUUID(),
          plan: effect.plan,
        });
        const approved = await services.permissions.requestPlanApproval(effect.plan, services.signal);
        if (services.signal?.aborted) {
          services.state.status = 'cancelled';
          services.events.emit({
            type: 'plan_exit_denied',
            timestamp: timestamp(),
            eventId: randomUUID(),
          });
          outcome.resultOverride = {
            ok: false,
            error: { code: 'CANCELLED', message: 'Plan approval was cancelled by user.' },
          };
          break;
        }
        if (approved) {
          setOperatingMode(services, 'agent');
          services.events.emit({
            type: 'plan_exit_approved',
            timestamp: timestamp(),
            eventId: randomUUID(),
          });
        } else {
          services.events.emit({
            type: 'plan_exit_denied',
            timestamp: timestamp(),
            eventId: randomUUID(),
          });
          outcome.resultOverride = {
            ok: false,
            error: {
              code: 'PLAN_EXIT_DENIED',
              message: 'The plan was not approved. Revise the plan and call exit_plan_mode again.',
            },
          };
        }
        break;
      }
      case 'askUser': {
        const request: UserQuestionRequest = {
          id: randomUUID(),
          questions: [{
            prompt: effect.question,
            options: effect.options,
            multiSelect: effect.multiSelect,
          }],
        };
        services.events.emit({
          type: 'user_question_requested',
          timestamp: timestamp(),
          eventId: randomUUID(),
          request,
        });
        const response = await services.permissions.requestUserAnswer(request);
        if (!response) {
          outcome.resultOverride = {
            ok: false,
            error: {
              code: 'INTERACTION_REQUIRED',
              message: 'User interaction is required but no answer collector is available',
            },
          };
        } else {
          outcome.resultOverride = {
            ok: true,
            data: {
              question: effect.question,
              options: effect.options,
              multiSelect: effect.multiSelect,
              answers: response.answers,
            },
          };
        }
        break;
      }
      case 'subagentStarted': {
        services.events.emit({
          type: 'subagent_started',
          timestamp: timestamp(),
          eventId: randomUUID(),
          kind: effect.kind,
          mode: effect.mode,
          task: effect.task,
          maxTurns: effect.maxTurns,
        });
        break;
      }
    }
  }
  return outcome;
}
