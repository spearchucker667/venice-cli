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
  private readonly extraDirs: string[];
  private readonly skills = new Map<string, Skill>();
  private readonly errors: string[] = [];

  constructor(globalDir = getGlobalSkillsDir(), projectDir?: string, extraDirs: string[] = []) {
    this.globalDir = globalDir;
    this.projectDir = projectDir || '';
    this.extraDirs = extraDirs;
  }

  discover(): void {
    this.skills.clear();
    this.errors.length = 0;
    for (const dir of [this.globalDir, this.projectDir, ...this.extraDirs]) {
      if (!dir || !fs.existsSync(dir) || !fs.lstatSync(dir).isDirectory()) {
        continue;
      }

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (error) {
        this.errors.push(
          `cannot read skills directory ${dir}: ${error instanceof Error ? error.message : String(error)}`
        );
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillPath = path.join(dir, entry.name, 'SKILL.md');
        if (!fs.existsSync(skillPath)) continue; // not a skill directory
        try {
          const skill = parseSkillMarkdown(skillPath);
          if (skill) {
            this.skills.set(skill.name, skill);
          } else {
            this.errors.push(`invalid skill manifest (missing name or description): ${skillPath}`);
          }
        } catch (error) {
          this.errors.push(
            `failed to parse skill ${skillPath}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }
  }

  /** Discovery errors, surfaced rather than swallowed (VC-KIMI-043). */
  getErrors(): string[] {
    return [...this.errors];
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
