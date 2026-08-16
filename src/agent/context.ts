/**
 * Context manager for the agent runtime.
 *
 * Assembles messages for model requests and tracks estimated token usage.
 */

import type { AgentMessage, AgentState, StructuredSummary } from './types.js';
import type { Message, MessageContent } from '../types/index.js';
import type { Skill } from '../skills/types.js';

export interface ContextLayer {
  name: string;
  messages: AgentMessage[];
  priority: number;
}

export interface ContextBudget {
  maxTokens: number;
  reservedCompletionTokens: number;
  compactionThreshold: number;
}

export class ContextManager {
  private readonly budget: ContextBudget;
  private systemContract: string;
  private projectInstructions: string;
  private workingMemory: string;
  private conversation: AgentMessage[] = [];
  private fileContext: AgentMessage[] = [];
  private toolResults: AgentMessage[] = [];
  private summary?: StructuredSummary;
  private activeSkills: Skill[] = [];

  constructor(budget?: Partial<ContextBudget>) {
    this.budget = {
      maxTokens: budget?.maxTokens ?? 128000,
      reservedCompletionTokens: budget?.reservedCompletionTokens ?? 16384,
      compactionThreshold: budget?.compactionThreshold ?? 0.75,
    };
    this.systemContract = this.defaultSystemContract();
    this.projectInstructions = '';
    this.workingMemory = '';
  }

  setModelContextLimit(limit: number): void {
    if (Number.isInteger(limit) && limit > 0) {
      this.budget.maxTokens = limit;
    }
  }

  setSystemContract(contract: string): void {
    this.systemContract = contract;
  }

  setProjectInstructions(instructions: string): void {
    this.projectInstructions = instructions;
  }

  setWorkingMemory(state: AgentState): void {
    const lines: string[] = [];
    lines.push(`Objective: ${state.objective}`);
    if (state.todos.length) {
      lines.push('Todos:');
      for (const todo of state.todos) {
        lines.push(`- [${todo.status}] ${todo.id}: ${todo.content}`);
      }
    }
    if (state.changedFiles.length) {
      lines.push('Changed files:');
      for (const file of state.changedFiles) lines.push(`- ${file}`);
    }
    if (state.relevantFiles.length) {
      lines.push('Relevant files:');
      for (const file of state.relevantFiles) lines.push(`- ${file}`);
    }
    if (state.checkpointCount !== undefined && state.checkpointCount > 0) {
      lines.push(
        `Checkpoints: ${state.checkpointCount} total, ` +
        `undo ${state.canUndoCheckpoints ? 'available' : 'unavailable'}, ` +
        `redo ${state.canRedoCheckpoints ? 'available' : 'unavailable'}`
      );
    }
    if (state.lastValidation) {
      lines.push(
        `Last validation: ${state.lastValidation.overallSuccess ? 'PASS' : 'FAIL'} ` +
        `(${state.lastValidation.commands.length} command${state.lastValidation.commands.length === 1 ? '' : 's'})`
      );
      for (const { command, exitCode } of state.lastValidation.commands) {
        lines.push(`  - [${exitCode === 0 ? 'PASS' : 'FAIL'}] ${command}`);
      }
    }
    if (state.subagentReports?.length) {
      lines.push('Recent subagent reports:');
      for (const report of state.subagentReports.slice(-3)) {
        lines.push(
          `- [${report.kind}] ${report.summary} ` +
          `(findings: ${report.findings.length}, files: ${report.filesInspected.length})`
        );
      }
    }
    if (state.skillSummaries?.length) {
      lines.push('Available skills (call skill_load to activate):');
      for (const skill of state.skillSummaries) {
        lines.push(`- ${skill.name}: ${skill.description}`);
      }
    }
    this.workingMemory = lines.join('\n');
  }

  setSummary(summary: StructuredSummary): void {
    this.summary = summary;
  }

  setActiveSkills(skills: Skill[]): void {
    this.activeSkills = skills;
  }

  addConversationMessage(message: AgentMessage): void {
    this.conversation.push(message);
  }

  setFileContext(messages: AgentMessage[]): void {
    this.fileContext = messages;
  }

  addToolResult(toolCallId: string, content: MessageContent): void {
    this.toolResults.push({ role: 'tool', content, tool_call_id: toolCallId });
  }

  buildMessages(): Message[] {
    const systemParts: string[] = [];
    if (this.systemContract) systemParts.push(this.systemContract);
    if (this.projectInstructions) systemParts.push(this.projectInstructions);
    if (this.workingMemory) systemParts.push(this.workingMemory);
    if (this.activeSkills.length) {
      systemParts.push('Active skills:');
      for (const skill of this.activeSkills) {
        systemParts.push(`<!-- skill: ${skill.name} -->\n${skill.content.trim()}`);
      }
    }
    if (this.summary) {
      systemParts.push(this.renderSummary(this.summary));
    }

    const systemMessage: Message = { role: 'system', content: systemParts.join('\n\n') };
    const messages: Message[] = [systemMessage];

    for (const msg of this.fileContext) messages.push(this.toApiMessage(msg));
    for (const msg of this.toolResults) messages.push(this.toApiMessage(msg));
    for (const msg of this.conversation) messages.push(this.toApiMessage(msg));

    return messages;
  }

  estimateTokens(): number {
    const text = JSON.stringify(this.buildMessages());
    // UTF-8 byte count / 4 is a reasonable fast heuristic for mixed text.
    return Math.ceil(Buffer.byteLength(text, 'utf-8') / 4);
  }

  shouldCompact(): boolean {
    const available = this.budget.maxTokens - this.budget.reservedCompletionTokens;
    return this.estimateTokens() > available * this.budget.compactionThreshold;
  }

  compact(summary: StructuredSummary): void {
    this.summary = summary;
    this.conversation = [];
    this.fileContext = [];
    this.toolResults = [];
  }

  private renderSummary(summary: StructuredSummary): string {
    const lines = ['Summary of earlier work:'];
    lines.push(`Objective: ${summary.objective}`);
    if (summary.completedWork.length) lines.push('Completed:', ...summary.completedWork.map((s) => `- ${s}`));
    if (summary.remainingWork.length) lines.push('Remaining:', ...summary.remainingWork.map((s) => `- ${s}`));
    if (summary.decisions.length) lines.push('Decisions:', ...summary.decisions.map((s) => `- ${s}`));
    if (summary.discoveries.length) lines.push('Discoveries:', ...summary.discoveries.map((s) => `- ${s}`));
    if (summary.filesChanged.length) lines.push('Files changed:', ...summary.filesChanged.map((s) => `- ${s}`));
    if (summary.failures.length) lines.push('Failures:', ...summary.failures.map((s) => `- ${s}`));
    return lines.join('\n');
  }

  private toApiMessage(message: AgentMessage): Message {
    const base: Message = { role: message.role, content: message.content };
    if (message.tool_calls) (base as any).tool_calls = message.tool_calls;
    if (message.tool_call_id) base.tool_call_id = message.tool_call_id;
    return base;
  }

  private defaultSystemContract(): string {
    return [
      'You are Venice Agent, a workspace-aware coding assistant.',
      'Inspect before editing.',
      'Never invent file contents or tool results.',
      'Never claim tests passed unless they were run successfully.',
      'Prefer minimal changes.',
      'Preserve user work.',
      'Validate after edits.',
      'Do not disclose secrets.',
    ].join('\n');
  }
}

export function buildStructuredSummary(state: AgentState): StructuredSummary {
  const commandsRun = state.toolHistory
    .filter((t) => t.toolName === 'shell' && t.result.ok)
    .map((t) => ({
      command: String((t.input as { command?: string })?.command || ''),
      result: t.result.ok ? 'success' : 'failure',
    }));

  return {
    objective: state.objective,
    completedWork: state.todos.filter((t) => t.status === 'completed').map((t) => t.content),
    remainingWork: state.todos.filter((t) => t.status !== 'completed').map((t) => t.content),
    decisions: [],
    discoveries: state.relevantFiles.map((f) => `Relevant file: ${f}`),
    filesRead: state.toolHistory.filter((t) => t.toolName === 'read_file').map((t) => String((t.input as { path?: string })?.path || '')),
    filesChanged: state.changedFiles,
    commandsRun,
    failures: state.toolHistory.filter((t) => !t.result.ok).map((t) => `${t.toolName}: ${t.result.error?.message || 'failed'}`),
    importantConstraints: [],
  };
}
