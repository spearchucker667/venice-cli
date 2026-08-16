import type { AgentStatus } from '../agent/types.js';
import { SLASH_COMMANDS } from './slash-commands.js';
import type { TuiMessage } from './types.js';
import { SessionManager, type StoredSession } from '../agent/sessions.js';
import type { AgentRuntime } from '../agent/runtime.js';
import type { McpManager } from '../mcp/manager.js';
import { scaffoldVeniceWorkspace } from '../commands/init.js';
import { createDefaultRegistry } from '../tools/registry.js';
import { gitDiffTool } from '../tools/git/diff.js';
import { gitStatusTool } from '../tools/git/status.js';

export interface SlashHandlerContext {
  exit: () => void;
  setMessages: (updater: (prev: TuiMessage[]) => TuiMessage[]) => void;
  status: AgentStatus;
  model: string;
  approvalMode: string;
  workspaceRoot: string;
  setModel?: (model: string) => void;
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

  switch (command) {
    case 'help':
      addEvent(
        'Available slash commands:\n' +
          SLASH_COMMANDS.map((c) => `  /${c}`).join('\n') +
          '\n\nType /help for this list, or /<command> to execute.'
      );
      break;

    case 'quit':
      exit();
      break;

    case 'clear':
      setMessages(() => []);
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
        setModel(requested);
        addEvent(`Model set to ${requested}.`);
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
      const toolCtx: any = { workspaceRoot, sessionId: '', objective: '', runtimeState: getRuntime?.()?.getState() };
      const res = await gitDiffTool.execute({}, toolCtx);
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
      const state = runtime?.getState();
      if (!state) {
        addEvent('No active session state to review.');
        break;
      }
      const lines = [
        `Session Review (${state.sessionId}):`,
        `Objective: ${state.objective || 'None'}`,
        `Status: ${state.status}`,
        `Changed Files (${state.changedFiles.length}):`,
      ];
      if (state.changedFiles.length === 0) {
        lines.push('  (none)');
      } else {
        for (const file of state.changedFiles) {
          lines.push(`  + ${file}`);
        }
      }
      if (state.lastValidation) {
        lines.push(`\nValidation: ${state.lastValidation.overallSuccess ? 'PASS' : 'FAIL'}`);
        for (const cmd of state.lastValidation.commands) {
          lines.push(`  ${cmd.exitCode === 0 ? '✓' : '✗'} ${cmd.command} (exit ${cmd.exitCode})`);
        }
      }
      addEvent(lines.join('\n'));
      break;
    }

    case 'plan': {
      const runtime = getRuntime?.();
      const state = runtime?.getState();
      const todos = state?.todos || [];
      if (todos.length === 0) {
        addEvent('No active plan or todo items.');
      } else {
        const lines = ['Current Plan / Tasks:'];
        for (const todo of todos) {
          const icon = todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '●' : todo.status === 'blocked' ? '✗' : '○';
          lines.push(`  ${icon} [${todo.status}] ${todo.content}`);
        }
        addEvent(lines.join('\n'));
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
      const registry = createDefaultRegistry();
      const defs = registry.definitions();
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
      addEvent(`Current Approval Mode: ${approvalMode}\nPermission Policies:\n  suggest   — Requires user approval for all file edits, shell commands, network requests, and external operations.\n  auto-edit — Auto-approves workspace file writes/edits; prompts for shell and network commands.\n  auto      — Auto-approves workspace edits and standard development commands.\n  yolo      — Autonomous workspace execution.`);
      break;
    }

    case 'git': {
      const toolCtx: any = { workspaceRoot, sessionId: '', objective: '', runtimeState: getRuntime?.()?.getState() };
      const res = await gitStatusTool.execute({}, toolCtx);
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

    default:
      addEvent(`Unknown command: /${command}. Type /help for available commands.`);
  }
}
