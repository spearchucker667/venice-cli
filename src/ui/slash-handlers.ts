/**
 * Handlers for TUI slash commands.
 */

import type { AgentStatus } from '../agent/types.js';
import { SLASH_COMMANDS } from './slash-commands.js';
import type { TuiMessage } from './types.js';
import { SessionManager } from '../agent/sessions.js';
import type { StoredSession } from '../agent/sessions.js';

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
}

export function handleSlashCommand(command: string, args: string, context: SlashHandlerContext): void {
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
  } = context;

  const addEvent = (content: string) => {
    setMessages((prev) => [...prev, { id: `cmd-${prev.length + 1}`, role: 'event', content }]);
  };

  switch (command) {
    case 'help':
      addEvent('Available slash commands:\n' + SLASH_COMMANDS.map((c) => `  /${c}`).join('\n'));
      break;
    case 'quit':
      exit();
      break;
    case 'clear':
      setMessages(() => []);
      break;
    case 'status':
      addEvent(`Model: ${model}\nWorkspace: ${workspaceRoot}\nStatus: ${status}\nApproval: ${approvalMode}`);
      break;
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
        void resumeSession(sessionId);
      } else {
        addEvent('Session resume is not available.');
      }
      break;
    }
    case 'sessions': {
      const sessions = listSessions ? listSessions() : new SessionManager().list();
      if (!sessions.length) {
        addEvent('No saved sessions.');
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
    case 'context':
    case 'compact':
    case 'new':
    case 'tools':
    case 'mcp':
    case 'skills':
    case 'permissions':
    case 'plan':
    case 'diff':
    case 'review':
    case 'git':
    case 'init':
      addEvent(`/${command} is not implemented yet.`);
      break;
    default:
      addEvent(`Unknown command: /${command}. Type /help for available commands.`);
  }
}
