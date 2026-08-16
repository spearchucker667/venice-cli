/**
 * spawn_agent tool — run a bounded read-only subagent and return structured findings.
 */

import { randomUUID } from 'node:crypto';
import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';
import { readFileTool } from '../filesystem/read.js';
import { readManyFilesTool } from '../filesystem/read-many.js';
import { listDirectoryTool } from '../filesystem/list.js';
import { globTool } from '../filesystem/glob.js';
import { grepTool } from '../search/grep.js';
import { findTool } from '../search/find.js';
import { gitStatusTool } from '../git/status.js';
import { gitDiffTool } from '../git/diff.js';
import { gitLogTool } from '../git/log.js';
import type { AgentStatus, SubagentKind, SubagentResult, ToolInvocation } from '../../agent/types.js';
import {
  buildReadOnlySubagentObjective,
  collectSubagentFilesInspected,
  normalizeSubagentKind,
  normalizeSubagentMaxTurns,
  parseSubagentReport,
} from '../../agent/subagents.js';

export interface SpawnAgentInput {
  task: string;
  kind?: SubagentKind;
  maxTurns?: number;
}

export interface RunSubagentOptions {
  workspaceRoot: string;
  parentSessionId: string;
  task: string;
  kind: SubagentKind;
  model: string;
  maxTurns: number;
}

export interface RunSubagentResult {
  finalMessage: string;
  state: {
    status: AgentStatus;
    changedFiles: string[];
    toolHistory: ToolInvocation[];
  };
}

interface SpawnAgentToolDeps {
  runSubagent?: (options: RunSubagentOptions) => Promise<RunSubagentResult>;
}

export function createSpawnAgentTool(deps: SpawnAgentToolDeps = {}): AgentTool<SpawnAgentInput, SubagentResult> {
  const runSubagent = deps.runSubagent || runReadOnlySubagent;

  return {
    name: 'spawn_agent',
    description: 'Run a bounded read-only subagent and return structured findings.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task for the subagent to investigate' },
        kind: { type: 'string', enum: ['explore', 'review', 'research', 'test', 'general'] },
        maxTurns: { type: 'number', description: 'Maximum reasoning turns for the subagent' },
      },
      required: ['task'],
    },
    risk: 'execute',
    async execute(input, context) {
      if (typeof input.task !== 'string' || !input.task.trim()) {
        return failure('INVALID_SUBAGENT_TASK', 'task must be a non-empty string');
      }

      const kind = normalizeSubagentKind(input.kind);
      const maxTurns = normalizeSubagentMaxTurns(input.maxTurns);

      let run: RunSubagentResult;
      try {
        run = await runSubagent({
          workspaceRoot: context.workspaceRoot,
          parentSessionId: context.sessionId,
          task: input.task.trim(),
          kind,
          model: context.runtimeState.model,
          maxTurns,
        });
      } catch (error) {
        return failure('SUBAGENT_RUN_ERROR', error instanceof Error ? error.message : String(error));
      }

      if (run.state.changedFiles.length > 0) {
        return failure(
          'SUBAGENT_WRITE_DETECTED',
          'Read-only subagent attempted to modify workspace files',
          { changedFiles: run.state.changedFiles }
        );
      }

      const parsed = parseSubagentReport(run.finalMessage);
      const report: SubagentResult = {
        mode: 'read-only',
        task: input.task.trim(),
        kind,
        status: run.state.status,
        summary: parsed.summary,
        findings: parsed.findings,
        recommendations: parsed.recommendations,
        filesInspected: collectSubagentFilesInspected(run.state.toolHistory),
      };

      return success(report, {
        truncated: report.findings.length > 30 || report.filesInspected.length > 200,
      });
    },
  };
}

export const spawnAgentTool = createSpawnAgentTool();

async function createReadOnlySubagentRegistry() {
  const { ToolRegistry } = await import('../registry.js');
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(readManyFilesTool);
  registry.register(listDirectoryTool);
  registry.register(globTool);
  registry.register(grepTool);
  registry.register(findTool);
  registry.register(gitStatusTool);
  registry.register(gitDiffTool);
  registry.register(gitLogTool);
  return registry;
}

async function runReadOnlySubagent(options: RunSubagentOptions): Promise<RunSubagentResult> {
  const { AgentRuntime } = await import('../../agent/runtime.js');
  const toolRegistry = await createReadOnlySubagentRegistry();
  const runtime = new AgentRuntime({
    sessionId: `${options.parentSessionId}-sub-${randomUUID()}`,
    workspaceRoot: options.workspaceRoot,
    objective: buildReadOnlySubagentObjective(options.task, options.kind),
    model: options.model,
    approvalMode: 'auto-edit',
    maxTurns: options.maxTurns,
    autoValidate: false,
    toolRegistry,
  });

  const result = await runtime.run();
  return {
    finalMessage: result.finalMessage,
    state: {
      status: result.state.status,
      changedFiles: result.state.changedFiles,
      toolHistory: result.state.toolHistory,
    },
  };
}
