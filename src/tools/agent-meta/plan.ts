/**
 * Plan-mode lifecycle tools.
 *
 * Plan mode is read-only except for the plan artifact itself: `write_plan`
 * is the ONLY file mutation available while planning, and it is restricted
 * to the plan file (PLAN.md by default, fixed after the first write).
 * `exit_plan_mode` presents the plan for explicit user approval — a policy
 * separate from ordinary tool approval that even YOLO cannot bypass.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';
import { WorkspaceManager, toWorkspacePath } from '../../agent/workspace.js';
import type { AgentState, PlanArtifact, PlanStep } from '../../agent/types.js';

export const DEFAULT_PLAN_FILE = 'PLAN.md';

export interface WritePlanInput {
  summary?: string;
  steps?: Array<string | { id?: string; text: string }>;
  filePath?: string;
}

function normalizeSteps(steps: unknown): PlanStep[] {
  if (!Array.isArray(steps)) return [];
  const result: PlanStep[] = [];
  let counter = 1;
  for (const step of steps) {
    if (typeof step === 'string' && step.trim()) {
      result.push({ id: String(counter), text: step.trim() });
      counter++;
    } else if (step && typeof step === 'object') {
      const text = (step as { text?: unknown }).text;
      if (typeof text === 'string' && text.trim()) {
        const explicitId = (step as { id?: unknown }).id;
        result.push({ id: typeof explicitId === 'string' && explicitId.trim() ? explicitId.trim() : String(counter), text: text.trim() });
        counter++;
      }
    }
  }
  return result;
}

export function renderPlanMarkdown(plan: PlanArtifact): string {
  const lines = ['# Plan', '', plan.summary || '_(no summary)_', ''];
  if (plan.steps.length) {
    lines.push('## Steps');
    for (const step of plan.steps) {
      lines.push(`${step.id}. ${step.text}`);
    }
    lines.push('');
  }
  lines.push(`_Updated: ${plan.updatedAt}_`);
  return lines.join('\n');
}

export const enterPlanModeTool: AgentTool<Record<string, never>, { mode: 'plan' }> = {
  name: 'enter_plan_mode',
  description:
    'Switch the agent into plan mode: read-only research and planning. The plan artifact is the only file write allowed.',
  inputSchema: { type: 'object', properties: {} },
  risk: 'read',
  planSafe: true,
  async execute() {
    return success({ mode: 'plan' as const });
  },
};

export const writePlanTool: AgentTool<WritePlanInput, { plan: PlanArtifact }> = {
  name: 'write_plan',
  description:
    'Write or update the plan artifact (PLAN.md). This is the only file mutation available in plan mode; the plan file path is fixed after the first write.',
  inputSchema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'One-paragraph plan summary' },
      steps: {
        type: 'array',
        items: { type: 'string' },
        description: 'Ordered plan steps',
      },
      filePath: {
        type: 'string',
        description: 'Optional plan file path inside the workspace (defaults to PLAN.md)',
      },
    },
  },
  risk: 'write',
  planSafe: true,
  async execute(input, context) {
    const workspace = new WorkspaceManager(context.workspaceRoot);
    const existing = (context.runtimeState as Readonly<AgentState>).plan;

    const requested =
      typeof input.filePath === 'string' && input.filePath.trim() ? input.filePath.trim() : undefined;

    let absolute: string;
    if (existing?.filePath) {
      // The plan artifact path is fixed once created: the model cannot
      // redirect the plan file to arbitrary workspace paths.
      absolute = existing.filePath;
      if (requested) {
        let requestedAbsolute: string;
        try {
          requestedAbsolute = workspace.resolve(requested).absolute;
        } catch {
          return failure('PLAN_FILE_OUTSIDE_WORKSPACE', `Plan file path is outside the workspace: ${requested}`);
        }
        if (requestedAbsolute !== existing.filePath) {
          return failure(
            'PLAN_FILE_LOCKED',
            `The plan file is already ${existing.filePath}; write_plan cannot redirect it.`
          );
        }
      }
    } else {
      if (requested) {
        try {
          absolute = workspace.resolve(requested).absolute;
        } catch {
          return failure('PLAN_FILE_OUTSIDE_WORKSPACE', `Plan file path is outside the workspace: ${requested}`);
        }
      } else {
        absolute = path.join(workspace.workspaceRoot, DEFAULT_PLAN_FILE);
      }
    }

    const summary = typeof input.summary === 'string' ? input.summary.trim() : '';
    const steps = normalizeSteps(input.steps);
    if (!summary && steps.length === 0) {
      return failure('INVALID_PLAN', 'write_plan requires a summary or at least one step');
    }

    const plan: PlanArtifact = {
      summary,
      steps,
      filePath: absolute,
      updatedAt: new Date().toISOString(),
    };

    try {
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, renderPlanMarkdown(plan));
    } catch (error) {
      return failure(
        'PLAN_WRITE_FAILED',
        error instanceof Error ? error.message : String(error)
      );
    }

    const relative = toWorkspacePath(path.relative(workspace.workspaceRoot, absolute));
    return success({ plan }, { affectedFiles: [relative] });
  },
};

export const exitPlanModeTool: AgentTool<Record<string, never>, { plan: PlanArtifact | null }> = {
  name: 'exit_plan_mode',
  description:
    'Present the current plan for explicit user approval and leave plan mode. When a plan exists, approval is required — even in YOLO mode.',
  inputSchema: { type: 'object', properties: {} },
  risk: 'read',
  planSafe: true,
  async execute(_input, context) {
    const plan = (context.runtimeState as Readonly<AgentState>).plan;
    return success({ plan: plan ?? null });
  },
};
