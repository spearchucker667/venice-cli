/**
 * Slash command parsing and registry for the TUI composer.
 */

export interface SlashCommand {
  command: string;
  args: string;
}

export function parseSlashCommand(input: string): SlashCommand | undefined {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return undefined;
  const [command, ...rest] = trimmed.slice(1).split(' ');
  return { command: command.toLowerCase(), args: rest.join(' ').trim() };
}

export const SLASH_COMMANDS: string[] = [
  'help',
  'model',
  'models',
  'status',
  'context',
  'compact',
  'clear',
  'new',
  'resume',
  'sessions',
  'tools',
  'mcp',
  'skills',
  'permissions',
  'plan',
  'diff',
  'review',
  'git',
  'init',
  'quit',
];
