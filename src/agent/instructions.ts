/**
 * Project instruction resolver.
 *
 * Loads hierarchical instructions from global user config, repository root,
 * and nested path-specific rules. Precedence (lowest to highest):
 *
 *   1. built-in agent contract
 *   2. global user instructions (~/.config/venice/AGENTS.md)
 *   3. repository instructions (AGENTS.md, VENICE.md, .venice/instructions.md)
 *   4. nested path instructions (.venice/rules/*.md)
 *
 * The current user request is supplied separately by the runtime and is not
 * loaded by this resolver.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const GLOBAL_INSTRUCTIONS_PATH = path.join(os.homedir(), '.config', 'venice', 'AGENTS.md');

export const BUILT_IN_AGENT_CONTRACT = [
  'You are Venice Agent, an interactive general AI agent running on a user\'s computer.',
  'Your primary goal is to help users with software engineering tasks by taking action — use the tools available to you to make real changes on the user\'s system.',
  'For simple questions, reply directly. For tasks, use tools. Do not just describe solutions in text.',
  'When a dedicated tool fits the job, reach for it before raw shell.',
  'If you anticipate making multiple non-interfering tool calls, you are HIGHLY RECOMMENDED to make them in parallel (especially read-only file inspections) to improve efficiency.',
  'When working on an existing codebase, read it with tools before making changes.',
  'Make MINIMAL changes to achieve the goal. Keep edits scoped to the files and modules the request actually implies. Leave unrelated refactors alone.',
  'Never invent file contents or tool results. Never claim tests passed unless they were run successfully.',
  'Do not disclose secrets.',
  'CRITICAL: Use your provided tools to accomplish the task. Do NOT tell the user to run CLI commands manually.',
  'CRITICAL: For generating images, audio, video, or searching the web, use your registered media tools (generate_image, generate_music, generate_video, text_to_speech, transcribe_audio, web_search) instead of asking the user to run "venice image" or "venice music".',
].join('\n');

export interface InstructionSource {
  source: string;
  content: string;
  scope?: string;
}

export interface ResolvedInstructions {
  text: string;
  sources: InstructionSource[];
}

function readFileIfExists(filePath: string): string | undefined {
  try {
    if (fs.existsSync(filePath) && fs.lstatSync(filePath).isFile()) {
      return fs.readFileSync(filePath, 'utf-8');
    }
  } catch {
    // ignore
  }
  return undefined;
}

function readRepoInstructions(workspaceRoot: string): InstructionSource[] {
  const sources: InstructionSource[] = [];
  const candidates = [
    { file: path.join(workspaceRoot, 'AGENTS.md'), scope: 'repository' },
    { file: path.join(workspaceRoot, 'VENICE.md'), scope: 'repository' },
    { file: path.join(workspaceRoot, '.venice', 'instructions.md'), scope: 'repository' },
  ];
  for (const { file, scope } of candidates) {
    const content = readFileIfExists(file);
    if (content !== undefined) {
      sources.push({ source: path.relative(workspaceRoot, file), content, scope });
    }
  }
  return sources;
}

function readNestedRules(workspaceRoot: string): InstructionSource[] {
  const rulesDir = path.join(workspaceRoot, '.venice', 'rules');
  const sources: InstructionSource[] = [];
  try {
    if (!fs.existsSync(rulesDir) || !fs.lstatSync(rulesDir).isDirectory()) {
      return sources;
    }

    const entries = fs.readdirSync(rulesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const filePath = path.join(rulesDir, entry.name);
      const content = readFileIfExists(filePath);
      if (content !== undefined) {
        // Scope applies to the subtree named like the file without .md
        const scope = entry.name.slice(0, -3);
        sources.push({ source: path.relative(workspaceRoot, filePath), content, scope });
      }
    }
  } catch {
    // Ignore read errors
  }
  return sources;
}

export async function loadInstructions(workspaceRoot: string): Promise<ResolvedInstructions> {
  const sources: InstructionSource[] = [];

  sources.push({ source: 'built-in', content: BUILT_IN_AGENT_CONTRACT });

  const globalContent = readFileIfExists(GLOBAL_INSTRUCTIONS_PATH);
  if (globalContent !== undefined) {
    sources.push({ source: GLOBAL_INSTRUCTIONS_PATH, content: globalContent, scope: 'global' });
  }

  sources.push(...readRepoInstructions(workspaceRoot));
  sources.push(...readNestedRules(workspaceRoot));

  const parts: string[] = [];
  for (const source of sources) {
    parts.push(`<!-- source: ${source.source}${source.scope ? ` (${source.scope})` : ''} -->`);
    parts.push(source.content.trim());
  }

  return { text: parts.join('\n\n'), sources };
}

export function instructionsForPath(instructions: ResolvedInstructions, targetPath: string): string {
  // Filter nested rules to only those whose scope matches the target path prefix.
  const relevant = instructions.sources.filter((s) => {
    if (!s.scope || s.scope === 'global' || s.scope === 'repository' || s.scope === 'built-in') {
      return true;
    }
    const normalized = path.normalize(targetPath);
    return normalized === s.scope || normalized.startsWith(s.scope + path.sep);
  });

  const parts: string[] = [];
  for (const source of relevant) {
    parts.push(`<!-- source: ${source.source}${source.scope ? ` (${source.scope})` : ''} -->`);
    parts.push(source.content.trim());
  }
  return parts.join('\n\n');
}
