/**
 * File mention resolution for the TUI composer.
 */

import * as path from 'node:path';
import { isPathInside } from '../agent/workspace.js';

export interface MentionResolution {
  text: string;
  mentions: string[];
}

export function resolveMentions(input: string): MentionResolution {
  const mentions: string[] = [];
  const mentionPattern = /@(?:"([^"]+)"|'([^']+)'|([^\s]+))/g;

  const text = input.replace(mentionPattern, (_match, doubleQuoted: string | undefined, singleQuoted: string | undefined, bare: string | undefined) => {
    const mention = doubleQuoted ?? singleQuoted ?? bare ?? '';
    if (mention && !mentions.includes(mention)) {
      mentions.push(mention);
    }
    return mention;
  });

  return { text, mentions };
}

export async function readMentionedFiles(workspaceRoot: string, mentions: string[]): Promise<string> {
  let combined = '';
  const fs = await import('node:fs/promises');
  
  const root = await fs.realpath(workspaceRoot).catch(() => path.resolve(workspaceRoot));

  const isTextFile = async (filePath: string): Promise<boolean> => {
    const buffer = Buffer.alloc(8192);
    let fd;
    try {
      fd = await fs.open(filePath, 'r');
      const { bytesRead } = await fd.read(buffer, 0, 8192, 0);
      for (let i = 0; i < bytesRead; i++) {
        if (buffer[i] === 0) return false; // null byte indicates binary
      }
      return true;
    } finally {
      if (fd) await fd.close();
    }
  };

  for (const mention of mentions) {
    try {
      if (path.isAbsolute(mention) || path.win32.isAbsolute(mention)) {
        combined += `\n[Error reading ${mention}: Path outside workspace]\n`;
        continue;
      }
      const fullPath = path.resolve(root, mention);

      if (!isPathInside(root, fullPath)) {
        combined += `\n[Error reading ${mention}: Path outside workspace]\n`;
        continue;
      }
      
      let realPath: string;
      try {
        realPath = await fs.realpath(fullPath);
      } catch {
        combined += `\n[Error reading ${mention}: File does not exist]\n`;
        continue;
      }

      // Ensure the path is within the workspace
      if (!isPathInside(root, realPath)) {
        combined += `\n[Error reading ${mention}: Path outside workspace]\n`;
        continue;
      }
      
      const stat = await fs.stat(realPath);
      if (stat.isDirectory()) {
        const entries = await fs.readdir(realPath, { withFileTypes: true });
        const list = entries
          .filter(e => !['node_modules', '.git', 'dist', 'build', 'target', 'coverage', '.next', 'vendor'].includes(e.name))
          .map(e => `  ${e.name}${e.isDirectory() ? '/' : ''}`)
          .slice(0, 100)
          .join('\n');
        combined += `\n\n--- Directory: ${mention} ---\n${list}\n`;
        if (entries.length > 100) combined += `  ... and ${entries.length - 100} more items\n`;
        continue;
      }
      
      if (stat.size > 1024 * 1024) { // 1MB limit for mentions
        combined += `\n[Error reading ${mention}: File too large (>${stat.size} bytes)]\n`;
        continue;
      }
      
      if (!(await isTextFile(realPath))) {
        combined += `\n[Error reading ${mention}: Binary file]\n`;
        continue;
      }
      
      const content = await fs.readFile(realPath, 'utf8');
      combined += `\n\n--- File: ${mention} ---\n${content}\n`;
    } catch (err) {
      combined += `\n[Error reading ${mention}: ${err instanceof Error ? err.message : String(err)}]\n`;
    }
  }
  return combined;
}
