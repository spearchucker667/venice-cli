/**
 * Parse SKILL.md files with YAML-style frontmatter.
 *
 * Keeps the parser intentionally small to avoid adding a runtime dependency.
 */

import * as fs from 'node:fs';
import type { Skill, SkillManifest } from './types.js';

export function parseFrontmatter(content: string): { metadata: Partial<SkillManifest>; body: string } {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('---')) {
    return { metadata: {}, body: content };
  }

  const end = trimmed.indexOf('\n---', 3);
  if (end === -1) {
    return { metadata: {}, body: content };
  }

  const frontmatter = trimmed.slice(3, end).trim();
  const body = trimmed.slice(end + 4).trimStart();
  return { metadata: parseYamlSubset(frontmatter), body };
}

function parseYamlSubset(text: string): Partial<SkillManifest> & Record<string, unknown> {
  const metadata: Partial<SkillManifest> & Record<string, unknown> = {};
  const lines = text.split('\n');
  let currentKey: string | undefined;
  let currentList: string[] | undefined;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim() || line.trim().startsWith('#')) {
      continue;
    }

    const listMatch = line.match(/^\s*-\s*(.+)$/);
    if (listMatch && currentKey) {
      if (!currentList) {
        currentList = [];
        metadata[currentKey] = currentList;
      }
      currentList.push(listMatch[1].trim());
      continue;
    }

    const keyMatch = line.match(/^\s*(\w+):\s*(.*)$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      currentList = undefined;
      const value = keyMatch[2].trim();
      if (value) {
        metadata[currentKey] = value;
      }
    }
  }

  return metadata;
}

export function parseSkillMarkdown(filePath: string): Skill | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const { metadata, body } = parseFrontmatter(content);

    if (!metadata.name || !metadata.description) {
      return undefined;
    }

    return {
      name: metadata.name,
      description: metadata.description,
      tools: Array.isArray(metadata.tools) ? metadata.tools : [],
      source: filePath,
      content: body,
    };
  } catch {
    return undefined;
  }
}
