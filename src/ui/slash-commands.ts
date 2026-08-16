/**
 * Slash command parsing and registry for the TUI composer.
 */

export interface SlashCommand {
  command: string;
  args: string;
}

export interface SlashCommandDefinition {
  name: string;
  aliases?: string[];
  description: string;
  availability: 'always' | 'idle';
}

export function parseSlashCommand(input: string): SlashCommand | undefined {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return undefined;
  const [command, ...rest] = trimmed.slice(1).split(' ');
  return { command: command.toLowerCase(), args: rest.join(' ').trim() };
}

export const SLASH_COMMANDS: SlashCommandDefinition[] = [
  { name: 'help', description: 'Show help and examples', availability: 'always' },
  { name: 'help all', aliases: [], description: 'List all slash commands', availability: 'always' },
  { name: 'quit', description: 'Exit the agent', availability: 'always' },
  { name: 'clear', description: 'Clear the transcript', availability: 'always' },
  { name: 'status', description: 'Show current model, workspace, and status', availability: 'always' },
  { name: 'model', description: 'Show model picker or set a model', availability: 'always' },
  { name: 'models', description: 'Show model picker', availability: 'always' },
  { name: 'resume', description: 'Resume a session', availability: 'always' },
  { name: 'sessions', description: 'List saved sessions', availability: 'always' },
  { name: 'diff', description: 'Show git diff or changed files', availability: 'always' },
  { name: 'review', description: 'Review current changes read-only', availability: 'always' },
  { name: 'plan', description: 'Toggle plan mode', availability: 'always' },
  { name: 'plan on', aliases: [], description: 'Enable plan mode', availability: 'always' },
  { name: 'plan off', aliases: [], description: 'Disable plan mode', availability: 'always' },
  { name: 'compact', description: 'Compact conversation context', availability: 'idle' },
  { name: 'tools', description: 'List registered tools', availability: 'always' },
  { name: 'mcp', description: 'List MCP servers', availability: 'always' },
  { name: 'skills', description: 'List available skills', availability: 'always' },
  { name: 'permissions', description: 'Show or change approval mode', availability: 'always' },
  { name: 'git', description: 'Show git status', availability: 'always' },
  { name: 'init', description: 'Initialize Venice workspace', availability: 'always' },
  { name: 'context', description: 'Show context overview', availability: 'always' },
  { name: 'new', description: 'Start a fresh conversation', availability: 'always' },
  { name: 'fork', description: 'Fork the current session', availability: 'always' },
  { name: 'title', description: 'Set or show session title', availability: 'always' },
  { name: 'rename', description: 'Set session title', availability: 'always' },
  { name: 'export', description: 'Export session as Markdown', availability: 'always' },
  { name: 'export-debug-zip', description: 'Export debug archive', availability: 'always' },
  { name: 'import', description: 'Import a session file', availability: 'always' },
];

export function findSlashCommands(query: string): SlashCommandDefinition[] {
  if (!query.startsWith('/')) return [];
  const q = query.slice(1).toLowerCase();
  return SLASH_COMMANDS.filter((cmd) => {
    if (cmd.name.includes(q)) return true;
    if (cmd.aliases?.some((a) => a.includes(q))) return true;
    if (cmd.description.toLowerCase().includes(q)) return true;
    return false;
  }).slice(0, 8);
}
