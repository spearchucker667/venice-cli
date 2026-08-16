/**
 * apply_patch tool — apply a unified diff patch to a file.
 */

import * as fs from 'node:fs';
import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';
import { WorkspaceManager } from '../../agent/workspace.js';

export const applyPatchTool: AgentTool<{ path: string; patch: string }, { applied: boolean }> = {
  name: 'apply_patch',
  description: 'Apply a unified diff patch to a file.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      patch: { type: 'string' },
    },
    required: ['path', 'patch'],
  },
  risk: 'write',
  async execute(input, context) {
    const workspace = new WorkspaceManager(context.workspaceRoot, context.workspace?.additionalRoots ?? []);
    try {
      const { absolute, relative, root } = workspace.resolve(input.path);
      const original = fs.readFileSync(absolute, 'utf-8');
      const lines = original.split('\n');
      const patchLines = input.patch.split('\n');

      let i = 0;
      while (i < patchLines.length) {
        const line = patchLines[i];
        const match = line.match(/^@@ -(\d+),?(\d*) \+\d+,?\d* @@/);
        if (match) {
          const oldStart = parseInt(match[1], 10) - 1;
          const oldCount = match[2] === '' ? 1 : parseInt(match[2], 10);
          const oldBlock: string[] = [];
          const newBlock: string[] = [];
          i++;
          while (i < patchLines.length && !patchLines[i].startsWith('@@')) {
            const patchLine = patchLines[i];
            if (patchLine === '' && i === patchLines.length - 1) {
              // Ignore trailing newline artifact
              i++;
              continue;
            }
            if (patchLine.startsWith('-')) oldBlock.push(patchLine.slice(1));
            else if (patchLine.startsWith('+')) newBlock.push(patchLine.slice(1));
            else if (!patchLine.startsWith('\\')) {
              // Context line starts with a single space
              const content = patchLine.startsWith(' ') ? patchLine.slice(1) : patchLine;
              oldBlock.push(content);
              newBlock.push(content);
            }
            i++;
          }
          const actual = lines.slice(oldStart, oldStart + oldCount);
          if (actual.join('\n') !== oldBlock.join('\n')) {
            return failure('PATCH_MISMATCH', `Patch does not match ${relative} at line ${oldStart + 1}`);
          }
          lines.splice(oldStart, oldCount, ...newBlock);
        } else {
          i++;
        }
      }

      const newContent = lines.join('\n');
      context.checkpointManager?.record({
        operation: 'apply_patch',
        relativePath: relative,
        originalContent: original,
        newContent,
      });
      fs.writeFileSync(absolute, newContent, 'utf-8');
      workspace.markChangedResolved({ absolute, relative, root });
      return success({ applied: true }, { affectedFiles: [relative] });
    } catch (error) {
      return failure('PATCH_ERROR', error instanceof Error ? error.message : String(error));
    }
  },
};
