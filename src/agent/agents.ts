/**
 * Custom main agent definitions (VCL-R3-031).
 *
 * `--agent <name>` selects a named agent from built-ins, the user config dir
 * (`~/.config/venice/agents/`), or the project dir (<workspace>/.venice/agents/).
 * `--agent-file <path>` loads a definition from a JSON or Markdown file.
 *
 * An agent is high-authority prompt configuration: its system prompt is
 * layered into the model context above project instructions. Definitions that
 * come from the project (a repo can commit them) therefore carry trust
 * guidance — the caller should surface that the repo controls the agent's
 * behavior.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export type AgentSource = 'builtin' | 'user' | 'project' | 'file';

export interface AgentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  /** Optional default model override. */
  model?: string;
  source: AgentSource;
  /** Absolute path of the definition file (user/project/file sources). */
  sourcePath?: string;
}

export function getUserAgentsDir(): string {
  return path.join(os.homedir(), '.config', 'venice', 'agents');
}

export function getProjectAgentsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.venice', 'agents');
}

const BUILTIN_AGENTS: Record<string, AgentDefinition> = {
  default: {
    name: 'default',
    description: 'The standard Venice agent (no custom system prompt).',
    systemPrompt: '',
    source: 'builtin',
  },
};

/** The built-in agent names that always resolve. */
export function builtinAgentNames(): string[] {
  return Object.keys(BUILTIN_AGENTS);
}

export interface ResolveAgentOptions {
  workspaceRoot: string;
}

/**
 * Resolve `--agent <name>`: built-ins first, then the user config dir, then
 * the project dir. Returns undefined when no matching definition exists.
 */
export function resolveAgent(
  name: string,
  options: ResolveAgentOptions
): AgentDefinition | undefined {
  const trimmed = name.trim();
  if (!trimmed) return undefined;

  if (BUILTIN_AGENTS[trimmed]) {
    return { ...BUILTIN_AGENTS[trimmed] };
  }

  // User definitions override nothing built-in but are next in precedence.
  for (const dir of [getUserAgentsDir(), getProjectAgentsDir(options.workspaceRoot)]) {
    for (const ext of ['json', 'md']) {
      const candidate = path.join(dir, `${trimmed}.${ext}`);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        const source: AgentSource = dir === getUserAgentsDir() ? 'user' : 'project';
        return loadAgentFile(candidate, source);
      }
    }
  }
  return undefined;
}

/**
 * Load `--agent-file <path>`. Paths inside the project agents dir are treated
 * as project definitions (high-authority, trust guidance applies); anything
 * else is a plain file the user pointed at directly.
 */
export function resolveAgentFile(
  filePath: string,
  options: ResolveAgentOptions
): AgentDefinition | undefined {
  const absolute = path.resolve(options.workspaceRoot, filePath);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    return undefined;
  }
  const projectDir = getProjectAgentsDir(options.workspaceRoot);
  const isProject = absolute.startsWith(projectDir + path.sep) || absolute === projectDir;
  return loadAgentFile(absolute, isProject ? 'project' : 'file');
}

/** Re-resolve a persisted agent identity (e.g. when resuming a session). */
export function resolvePersistedAgent(
  agent: { name: string; source: string; sourcePath?: string },
  options: ResolveAgentOptions
): AgentDefinition | undefined {
  if (!agent || typeof agent !== 'object' || typeof agent.name !== 'string') return undefined;
  if (agent.source === 'file' && agent.sourcePath) {
    return loadAgentFile(agent.sourcePath, 'file');
  }
  if (agent.source === 'builtin') {
    return BUILTIN_AGENTS[agent.name] ? { ...BUILTIN_AGENTS[agent.name] } : undefined;
  }
  return resolveAgent(agent.name, options);
}

/**
 * Load an agent definition from a JSON or Markdown file.
 *
 * JSON: `{ "name", "description", "systemPrompt", "model" }`.
 * Markdown: YAML-ish frontmatter (`name`, `description`, `model`) with the
 * body used as the system prompt.
 *
 * Returns undefined for unreadable or structurally invalid files.
 */
export function loadAgentFile(filePath: string, source: AgentSource): AgentDefinition | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return undefined;
  }
  const ext = path.extname(filePath).toLowerCase();
  const fallbackName = path.basename(filePath, ext);

  if (ext === '.json') {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return undefined;
    }
    if (!parsed || typeof parsed !== 'object') return undefined;
    const systemPrompt =
      typeof parsed.systemPrompt === 'string'
        ? parsed.systemPrompt
        : typeof parsed.prompt === 'string'
          ? parsed.prompt
          : '';
    const name = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : fallbackName;
    return {
      name,
      description: typeof parsed.description === 'string' ? parsed.description : name,
      systemPrompt,
      model: typeof parsed.model === 'string' ? parsed.model : undefined,
      source,
      sourcePath: filePath,
    };
  }

  // Markdown with frontmatter.
  const frontmatter = parseFrontmatter(raw);
  const name = frontmatter.meta.name || fallbackName;
  return {
    name,
    description: frontmatter.meta.description || name,
    systemPrompt: frontmatter.body.trim(),
    model: frontmatter.meta.model,
    source,
    sourcePath: filePath,
  };
}

function parseFrontmatter(raw: string): {
  meta: { name?: string; description?: string; model?: string };
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return { meta: {}, body: raw };
  const meta: { name?: string; description?: string; model?: string } = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key === 'name') meta.name = value || undefined;
    if (key === 'description') meta.description = value || undefined;
    if (key === 'model') meta.model = value || undefined;
  }
  return { meta, body: match[2] ?? '' };
}
