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

/**
 * The canonical base command name for a (possibly sub-command) definition,
 * e.g. `plan view` -> `plan`. Handlers are keyed by base command.
 */
export function getSlashCommandBase(name: string): string {
  return name.split(' ')[0].toLowerCase();
}

/**
 * Statuses during which the agent is actively running a turn. Commands that
 * require an idle agent (availability: 'idle') are unavailable while running.
 */
export function isBusyStatus(status: string): boolean {
  return status === 'thinking' || status === 'awaiting_approval' || status === 'executing_tool' || status === 'verifying';
}

/**
 * Find the metadata entry for a parsed command token. Matches the base entry
 * (e.g. `plan`) or, when absent, the first sub-command variant (e.g. `plan on`).
 */
export function findSlashCommandDefinition(command: string): SlashCommandDefinition | undefined {
  const base = getSlashCommandBase(command);
  return (
    SLASH_COMMANDS.find((c) => c.name === command || c.aliases?.includes(command)) ??
    SLASH_COMMANDS.find((c) => getSlashCommandBase(c.name) === base || c.aliases?.some(a => getSlashCommandBase(a) === base))
  );
}

/**
 * Find the closest matching slash command for typos.
 */
export function findNearestSlashCommand(command: string): string | undefined {
  const base = getSlashCommandBase(command);
  let bestMatch: string | undefined;
  let minDistance = Infinity;

  const allNames = SLASH_COMMANDS.flatMap(c => [c.name, ...(c.aliases || [])]);
  
  for (const name of allNames) {
    const dist = levenshteinDistance(base, getSlashCommandBase(name));
    if (dist < minDistance) {
      minDistance = dist;
      bestMatch = name;
    }
  }

  return minDistance <= 2 ? bestMatch : undefined;
}

function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Dynamically contribute slash definitions for available skills so active
 * skills participate in composer completion (VCL-R3-032). Each skill maps to
 * a `/skill <name>` invocation.
 */
export function skillSlashCommands(skillNames: string[]): SlashCommandDefinition[] {
  return skillNames.map((name) => ({
    name: `skill ${name}`,
    description: `Load the '${name}' skill`,
    availability: 'always' as const,
  }));
}

/**
 * Enforce the `availability` metadata (VC-KIMI-046): an `idle`-only command
 * must be rejected while the agent is running a turn.
 */
export function isSlashCommandAvailable(definition: SlashCommandDefinition, status: string): boolean {
  return definition.availability !== 'idle' || !isBusyStatus(status);
}

export const SLASH_COMMANDS: SlashCommandDefinition[] = [
  { name: 'help', description: 'Show help and examples', availability: 'always' },
  { name: 'help all', aliases: [], description: 'List all slash commands', availability: 'always' },
  { name: 'quit', description: 'Exit the agent', availability: 'always' },
  { name: 'clear', description: 'Clear conversation and start a fresh session', availability: 'always' },
  { name: 'clear-ui', description: 'Clear the transcript only (agent context is kept)', availability: 'always' },
  { name: 'status', description: 'Show current model, workspace, and status', availability: 'always' },
  { name: 'model', aliases: ['models'], description: 'Show model picker or set a model', availability: 'always' },
  { name: 'resume', description: 'Resume a session', availability: 'always' },
  { name: 'sessions', description: 'List saved sessions', availability: 'always' },
  { name: 'diff', description: 'Show git diff or changed files', availability: 'always' },
  { name: 'review', description: 'Review current changes read-only', availability: 'always' },
  { name: 'plan', description: 'Toggle plan mode', availability: 'always' },
  { name: 'plan on', aliases: [], description: 'Enable plan mode', availability: 'always' },
  { name: 'plan off', aliases: [], description: 'Disable plan mode', availability: 'always' },
  { name: 'plan view', aliases: [], description: 'Show the current plan artifact', availability: 'always' },
  { name: 'plan clear', aliases: [], description: 'Clear the current plan artifact', availability: 'always' },
  { name: 'auto', description: 'Set approval mode to auto (execute safe tools automatically)', availability: 'always' },
  { name: 'yolo', description: 'Set approval mode to yolo (execute all tools automatically)', availability: 'always' },
  { name: 'config', aliases: ['settings'], description: 'Open the interactive configuration hub', availability: 'always' },
  { name: 'effort', description: 'Configure the agent effort level', availability: 'always' },
  { name: 'reload', description: 'Reload configuration and skills', availability: 'always' },
  { name: 'plugins', description: 'Manage plugins', availability: 'always' },
  { name: 'theme', description: 'Change the UI theme', availability: 'always' },
  { name: 'compact', description: 'Compact conversation context', availability: 'idle' },
  { name: 'tools', description: 'List registered tools', availability: 'always' },
  { name: 'mcp', description: 'List MCP servers', availability: 'always' },
  { name: 'skills', description: 'List available skills', availability: 'always' },
  { name: 'skill', description: 'Load a skill by name (e.g. /skill release)', availability: 'always' },
  { name: 'permissions', description: 'Show or change approval mode', availability: 'always' },
  { name: 'git', description: 'Show git status', availability: 'always' },
  { name: 'init', description: 'Initialize Venice workspace', availability: 'always' },
  { name: 'context', description: 'Show context overview', availability: 'always' },
  { name: 'new', description: 'Start a fresh conversation', availability: 'always' },
  { name: 'fork', description: 'Fork the current session', availability: 'always' },
  { name: 'title', description: 'Set or show session title', availability: 'always' },
  { name: 'rename', description: 'Set session title', availability: 'always' },
  { name: 'export', description: 'Export session as Markdown', availability: 'always' },
  { name: 'import', description: 'Import a session file', availability: 'always' },
];

export function findSlashCommands(
  query: string,
  extra: SlashCommandDefinition[] = []
): SlashCommandDefinition[] {
  if (!query.startsWith('/')) return [];
  const q = query.slice(1).toLowerCase();
  const all = [...SLASH_COMMANDS, ...extra];
  return all
    .filter((cmd) => {
      if (cmd.name.includes(q)) return true;
      if (cmd.aliases?.some((a) => a.includes(q))) return true;
      if (cmd.description.toLowerCase().includes(q)) return true;
      return false;
    })
    .slice(0, 8);
}
