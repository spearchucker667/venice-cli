/**
 * Handlers for TUI slash commands.
 */

import type { AgentStatus } from '../agent/types.js';
import { SLASH_COMMANDS } from './slash-commands.js';
import type { TuiMessage } from './types.js';

export interface SlashHandlerContext {
  exit: () => void;
  setMessages: (updater: (prev: TuiMessage[]) => TuiMessage[]) => void;
  status: AgentStatus;
  model: string;
  approvalMode: string;
  workspaceRoot: string;
}

export function handleSlashCommand(command: string, args: string, context: SlashHandlerContext): void {
  const { exit, setMessages, status, model, approvalMode, workspaceRoot } = context;

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
    case 'model':
      addEvent(args ? `Switching model is not yet implemented (requested: ${args}).` : 'Current model: ' + model);
      break;
    case 'context':
    case 'compact':
    case 'new':
    case 'resume':
    case 'sessions':
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
