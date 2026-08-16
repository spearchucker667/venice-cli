import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentState, AgentStatus } from '../agent/types.js';
import { defaultMode } from '../agent/mode.js';
import { SLASH_COMMANDS } from './slash-commands.js';
import type { TuiMessage } from './types.js';
import { SessionManager, type StoredSession } from '../agent/sessions.js';
import { SessionImportService } from '../agent/session-import.js';
import type { AgentRuntime } from '../agent/runtime.js';
import type { McpManager } from '../mcp/manager.js';
import { scaffoldVeniceWorkspace } from '../commands/init.js';
import { gitDiffTool } from '../tools/git/diff.js';
import { gitStatusTool } from '../tools/git/status.js';
import type { ToolContext } from '../tools/types.js';
import type { ApprovalMode } from '../agent/permissions.js';
import type { ModelProfile } from '../agent/model-profile.js';

function formatSessionAsMarkdown(state: AgentState): string {
  const lines: string[] = [];
  lines.push(`# Session ${state.sessionId}`);
  if (state.title) lines.push(`## ${state.title}`);
  if (state.parentSessionId) lines.push(`Parent: ${state.parentSessionId}`);
  lines.push(`Model: ${state.model}`);
  lines.push(`Workspace: ${state.workspaceRoot}`);
  lines.push(`Objective: ${state.objective || '(none)'}`);
  lines.push('');
  lines.push('## Messages');
  for (const message of state.messages) {
    if (typeof message.content !== 'string') continue;
    lines.push(`### ${message.role}`);
    lines.push(message.content);
    lines.push('');
  }
  if (state.changedFiles.length) {
    lines.push('## Changed Files');
    for (const file of state.changedFiles) lines.push(`- ${file}`);
    lines.push('');
  }
  return lines.join('\n');
}

export interface SlashHandlerContext {
  exit: () => void;
  setMessages: (updater: (prev: TuiMessage[]) => TuiMessage[]) => void;
  status: AgentStatus;
  model: string;
  approvalMode: string;
  setApprovalMode?: (mode: ApprovalMode) => void;
  workspaceRoot: string;
  setModel?: (model: string) => void | ModelProfile | Promise<void | ModelProfile>;
  showModelPicker?: () => void;
  showSessionPicker?: () => void;
  resumeSession?: (sessionId: string) => void | Promise<void>;
  listSessions?: () => StoredSession[];
  mcpManager?: McpManager;
  getRuntime?: () => AgentRuntime | undefined;
}

export async function handleSlashCommand(command: string, args: string, context: SlashHandlerContext): Promise<void> {
  const {
    exit,
    setMessages,
    status,
    model,
    approvalMode,
    setApprovalMode,
    workspaceRoot,
    setModel,
    showModelPicker,
    showSessionPicker,
    resumeSession,
    listSessions,
    mcpManager,
    getRuntime,
  } = context;

  const addEvent = (content: string) => {
    setMessages((prev) => [...prev, { id: `cmd-${prev.length + 1}`, role: 'event', content }]);
  };
  const toolContext = (): ToolContext => {
    const state = getRuntime?.()?.getState();
    const runtimeState: Readonly<AgentState> = state ?? {
      sessionId: 'slash-command', workspaceRoot, workspace: { primaryRoot: workspaceRoot, additionalRoots: [] }, model, objective: '', status: 'idle',
      mode: defaultMode(),
      messages: [], todos: [], relevantFiles: [], changedFiles: [], toolHistory: [],
      skillSummaries: [], activeSkills: [], subagentReports: [],
    };
    return { workspaceRoot, sessionId: runtimeState.sessionId, objective: runtimeState.objective, runtimeState };
  };

  switch (command) {
    case 'help':
      if (args.trim() === 'all') {
        addEvent('All slash commands:\n' + SLASH_COMMANDS.map((c) => `  /${c.name} — ${c.description}`).join('\n'));
      } else {
        addEvent('Venice Agent\nJust tell Venice what you want done.\n\nExamples:\n  Explain this repository\n  Fix the failing tests\n  Search Venice docs\n  Generate an image\n\nContext:\n  @file\nShell:\n  !command\nControls:\n  /model\n  /status\n  /permissions\n  /new\n  /resume\n  /help all');
      }
      break;

    case 'quit':
      exit();
      break;

    case 'clear':
      // /clear is a fresh-session alias (Kimi parity): clearing only the
      // transcript while the model retains context is misleading and
      // dangerous (VC-KIMI-023). Use /clear-ui for transcript-only.
      getRuntime?.()?.resetSession();
      setMessages(() => []);
      addEvent('Conversation cleared — started a fresh session. Use /clear-ui to clear only the transcript.');
      break;

    case 'clear-ui':
      setMessages(() => []);
      addEvent('Transcript cleared (UI only). The agent conversation context is unchanged.');
      break;

    case 'status': {
      const runtime = getRuntime?.();
      const state = runtime?.getState();
      const lines = [
        `Model: ${model}`,
        `Workspace: ${workspaceRoot}`,
        `Status: ${status}`,
        `Approval Mode: ${approvalMode}`,
      ];
      if (state) {
        lines.push(`Session ID: ${state.sessionId}`);
        lines.push(`Changed Files: ${state.changedFiles.length}`);
        lines.push(`Active Todos: ${state.todos.length}`);
      }
      addEvent(lines.join('\n'));
      break;
    }

    case 'model': {
      const requested = args.trim();
      if (!requested) {
        if (showModelPicker) {
          showModelPicker();
        } else {
          addEvent('Current model: ' + model);
        }
      } else if (setModel) {
        const profile = await setModel(requested);
        addEvent(profile?.mode === 'chat-only'
          ? `Model set to ${requested}. Chat only — agent tools unavailable.`
          : `Model set to ${requested}.`);
      } else {
        addEvent('Current model: ' + model);
      }
      break;
    }

    case 'models': {
      if (showModelPicker) {
        showModelPicker();
      } else {
        addEvent('Model picker is not available.');
      }
      break;
    }

    case 'resume': {
      const sessionId = args.trim();
      if (!sessionId) {
        if (showSessionPicker) {
          showSessionPicker();
        } else {
          addEvent('Session picker is not available.');
        }
      } else if (resumeSession) {
        await resumeSession(sessionId);
      } else {
        addEvent('Session resume is not available.');
      }
      break;
    }

    case 'sessions': {
      const sessions = listSessions ? listSessions() : new SessionManager().list(workspaceRoot);
      if (!sessions.length) {
        addEvent('No saved sessions in this workspace.');
      } else {
        addEvent(
          'Saved sessions:\n' +
            sessions
              .map((s) => `  ${s.sessionId} — ${new Date(s.updatedAt).toLocaleString()} — ${s.state.objective || 'No objective'}`)
              .join('\n')
        );
      }
      break;
    }

    case 'diff': {
      const res = await gitDiffTool.execute({}, toolContext());
      if (res.ok && res.data) {
        addEvent(`Git Diff:\n${res.data}`);
      } else {
        const runtime = getRuntime?.();
        const changed = runtime?.getState().changedFiles || [];
        if (changed.length > 0) {
          addEvent(`Changed files in session:\n${changed.map((f) => `  ${f}`).join('\n')}`);
        } else {
          addEvent('No git diff or changed files.');
        }
      }
      break;
    }

    case 'review': {
      const runtime = getRuntime?.();
      if (!runtime) {
        addEvent('No active session state to review.');
        break;
      }
      addEvent('Reviewing the current diff in read-only mode…');
      try {
        const review = await runtime.reviewChanges();
        const lines = [`Review: ${review.summary}`];
        if (review.findings.length === 0) lines.push('No actionable findings.');
        else lines.push(...review.findings.map((finding) => {
          const location = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ''}` : undefined;
          const prefix = [finding.severity?.toUpperCase(), location].filter(Boolean).join(' · ');
          return `  • ${prefix ? `${prefix}: ` : ''}${finding.description}`;
        }));
        if (review.recommendations.length) lines.push('Recommendations:', ...review.recommendations.map((item) => `  • ${item}`));
        addEvent(lines.join('\n'));
      } catch (error) {
        addEvent(`Review failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      break;
    }

    case 'plan': {
      const runtime = getRuntime?.();
      if (!runtime) {
        addEvent('No active plan.');
        break;
      }
      const arg = args.trim();
      const current = runtime.getMode().operatingMode;
      if (arg === 'on' || (!arg && current !== 'plan')) {
        runtime.setMode({ operatingMode: 'plan' });
        addEvent('Plan mode enabled. Tools are read-only; the plan artifact is the only file write allowed.');
      } else if (arg === 'off' || (!arg && current === 'plan')) {
        runtime.setMode({ operatingMode: 'agent' });
        addEvent('Plan mode disabled. Agent may now execute writes and shell.');
      } else if (arg === 'view') {
        const plan = runtime.getState().plan;
        if (!plan) {
          addEvent('No plan has been written yet. Ask the agent to draft a plan, or use /plan on and describe the task.');
        } else {
          const steps = plan.steps.length
            ? '\n' + plan.steps.map((s) => `${s.id}. ${s.text}`).join('\n')
            : '';
          addEvent(`Plan (${plan.filePath}):\n${plan.summary || '(no summary)'}${steps}`);
        }
      } else if (arg === 'clear') {
        runtime.clearPlan();
        addEvent('Plan cleared.');
      } else {
        addEvent('Plan mode controls: /plan on, /plan off, /plan view, /plan clear.');
      }
      break;
    }

    case 'compact': {
      const runtime = getRuntime?.();
      if (runtime) {
        runtime.forceCompact();
        addEvent('Context compacted successfully.');
      } else {
        addEvent('No active runtime available for compaction.');
      }
      break;
    }

    case 'tools': {
      const defs = getRuntime?.()?.getToolDefinitions() ?? [];
      const lines = ['Registered Tools:'];
      for (const def of defs) {
        lines.push(`  • ${def.function.name} — ${def.function.description?.split('.')[0] || ''}`);
      }
      addEvent(lines.join('\n'));
      break;
    }

    case 'mcp': {
      if (!mcpManager) {
        addEvent('MCP Manager is not active.');
        break;
      }
      const states = mcpManager.getServerStates();
      if (states.length === 0) {
        addEvent('No MCP servers configured or running.');
      } else {
        const lines = ['MCP Servers:'];
        for (const s of states) {
          lines.push(`  • ${s.name}: ${s.tools.length} tools ${s.error ? `(error: ${s.error})` : '(running)'}`);
        }
        addEvent(lines.join('\n'));
      }
      break;
    }

    case 'skills': {
      const runtime = getRuntime?.();
      if (runtime) {
        const skills = runtime.getState().skillSummaries || [];
        if (skills.length === 0) {
          addEvent('No skills discovered or loaded.');
        } else {
          const lines = ['Available Skills:'];
          for (const s of skills) {
            lines.push(`  • ${s.name} — ${s.description}`);
          }
          addEvent(lines.join('\n'));
        }
      } else {
        addEvent('No active runtime to query skills.');
      }
      break;
    }

    case 'permissions': {
      const requested = args.trim();
      const validModes: ApprovalMode[] = ['suggest', 'auto-edit', 'auto', 'yolo'];
      if (requested) {
        if (!validModes.includes(requested as ApprovalMode)) {
          addEvent(`Unknown permission mode: ${requested}. Expected: ${validModes.join(', ')}`);
          break;
        }
        const next = requested as ApprovalMode;
        // Route through the single runtime-owned write path so the live
        // PermissionManager, persisted mode, and UI stay in lockstep
        // (VC-KIMI-024). The mode_changed event updates the UI.
        getRuntime?.()?.setPermissionMode(next);
        setApprovalMode?.(next);
        addEvent(`Approval mode changed to ${next} for this session.`);
        break;
      }
      const current = getRuntime?.()?.getPermissionManager().getMode() ?? approvalMode;
      addEvent(`Current Approval Mode: ${current}\nPermission Policies:\n  suggest   — Requires user approval for all file edits, shell commands, network requests, and external operations.\n  auto-edit — Auto-approves workspace file writes/edits; prompts for shell and network commands.\n  auto      — Auto-approves workspace edits and standard development commands.\n  yolo      — Autonomous workspace execution.`);
      break;
    }

    case 'git': {
      const res = await gitStatusTool.execute({}, toolContext());
      if (res.ok) {
        addEvent(`Git Status:\n${res.data}`);
      } else {
        addEvent(`Git error: ${res.error?.message}`);
      }
      break;
    }

    case 'init': {
      try {
        const res = scaffoldVeniceWorkspace(workspaceRoot);
        const lines = [`Venice workspace initialized at ${res.workspaceRoot}`];
        if (res.createdFiles.length) {
          lines.push('Created:');
          for (const f of res.createdFiles) lines.push(`  + ${f}`);
        }
        if (res.skippedFiles.length) {
          lines.push('Skipped existing:');
          for (const f of res.skippedFiles) lines.push(`  - ${f}`);
        }
        addEvent(lines.join('\n'));
      } catch (err) {
        addEvent(`Init error: ${err instanceof Error ? err.message : String(err)}`);
      }
      break;
    }

    case 'context': {
      const runtime = getRuntime?.();
      const state = runtime?.getState();
      const lines = [
        `Context Overview:`,
        `Workspace: ${workspaceRoot}`,
        `Model: ${model}`,
        `Messages in session: ${state?.messages.length ?? 0}`,
        `Active skills: ${state?.activeSkills?.join(', ') || 'none'}`,
        `Subagent reports: ${state?.subagentReports?.length ?? 0}`,
      ];
      const manager = runtime?.getContextManager();
      const used = manager?.estimateTokens() ?? 0;
      const limit = manager?.getMaxTokens() ?? 0;
      lines.push(`Context tokens: ${used}`);
      lines.push(`Context limit: ${limit || 'unknown'}`);
      lines.push(`Utilization: ${limit ? `${Math.round((used / limit) * 100)}%` : 'unknown'}`);
      lines.push(`Relevant files: ${state?.relevantFiles.length ?? 0}`);
      lines.push(`MCP tools: ${mcpManager?.getServerStates().reduce((count, server) => count + server.tools.length, 0) ?? 0}`);
      addEvent(lines.join('\n'));
      break;
    }

    case 'new': {
      const runtime = getRuntime?.();
      if (runtime) {
        runtime.resetSession();
      }
      setMessages(() => []);
      addEvent('Started fresh conversation context.');
      break;
    }

    case 'fork': {
      const runtime = getRuntime?.();
      if (!runtime) {
        addEvent('No active runtime.');
        break;
      }
      try {
        // forkSession persists the fork before returning so an immediate
        // resume cannot fail (VC-KIMI-010).
        const forkedId = await runtime.forkSession();
        addEvent(`Forked session: ${forkedId}`);
        if (resumeSession) {
          await resumeSession(forkedId);
        }
      } catch (error) {
        addEvent(`Fork failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      break;
    }

    case 'title':
    case 'rename': {
      const runtime = getRuntime?.();
      if (!runtime) {
        addEvent('No active runtime.');
        break;
      }
      const title = args.trim();
      if (!title) {
        addEvent(`Current title: ${runtime.getState().title || '(none)'}`);
        break;
      }
      runtime.setTitle(title);
      addEvent(`Title set to: ${title}`);
      break;
    }

    case 'export': {
      const runtime = getRuntime?.();
      if (!runtime) {
        addEvent('No active runtime.');
        break;
      }
      const state = runtime.getState();
      const markdown = formatSessionAsMarkdown(state);
      const target = args.trim() || path.join(workspaceRoot, `${state.sessionId}.md`);
      try {
        fs.writeFileSync(target, markdown);
        addEvent(`Exported session to ${target}`);
      } catch (error) {
        addEvent(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      break;
    }

    case 'export-debug-zip': {
      const runtime = getRuntime?.();
      if (!runtime) {
        addEvent('No active runtime.');
        break;
      }
      addEvent('Debug zip export is not yet implemented.');
      break;
    }

    case 'import': {
      const filePath = args.trim();
      if (!filePath) {
        addEvent('Usage: /import <path>');
        break;
      }
      try {
        // Import must persist the session before it can be resumed
        // (VC-KIMI-011) — the shared service handles both.
        const result = new SessionImportService().importFile(filePath);
        addEvent(`Imported session ${result.sessionId}${result.importedAs === 'forked' ? ' (forked)' : ''}`);
        if (resumeSession) {
          await resumeSession(result.sessionId);
        }
      } catch (error) {
        addEvent(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      break;
    }

    default:
      addEvent(`Unknown command: /${command}. Type /help for available commands.`);
  }
}
