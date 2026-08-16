/**
 * Skill discovery registry.
 *
 * Discovers skills from a global user directory and an optional project directory.
 * Each skill lives in its own subdirectory containing a `SKILL.md` file.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parseSkillMarkdown } from './parser.js';
import type { Skill, SkillSummary } from './types.js';

export function getGlobalSkillsDir(): string {
  return path.join(os.homedir(), '.config', 'venice', 'skills');
}

export function getProjectSkillsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.venice', 'skills');
}

export class SkillRegistry {
  private readonly globalDir: string;
  private readonly projectDir: string;
  private readonly skills = new Map<string, Skill>();

  constructor(globalDir = getGlobalSkillsDir(), projectDir?: string) {
    this.globalDir = globalDir;
    this.projectDir = projectDir || '';
  }

  discover(): void {
    this.skills.clear();
    for (const dir of [this.globalDir, this.projectDir]) {
      if (!dir || !fs.existsSync(dir) || !fs.lstatSync(dir).isDirectory()) {
        continue;
      }
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }
        const skillPath = path.join(dir, entry.name, 'SKILL.md');
        const skill = parseSkillMarkdown(skillPath);
        if (skill) {
          this.skills.set(skill.name, skill);
        }
      }
    }
  }

  list(): SkillSummary[] {
    return Array.from(this.skills.values()).map((skill) => ({
      name: skill.name,
      description: skill.description,
      tools: skill.tools,
      source: skill.source,
    }));
  }

  load(name: string): Skill | undefined {
    return this.skills.get(name);
  }
}
