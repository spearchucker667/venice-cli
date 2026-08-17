/**
 * edit_file tool — replace an exact string in a file.
 */

import * as fs from 'node:fs';
import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';
import { WorkspaceManager, toFileRef } from '../../agent/workspace.js';

export const editFileTool: AgentTool<{ path: string; oldString: string; newString: string }, { replacements: number }> = {
  name: 'edit_file',
  description: 'Replace an exact string in a file.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      oldString: { type: 'string' },
      newString: { type: 'string' },
    },
    required: ['path', 'oldString', 'newString'],
  },
  risk: 'write',
  async execute(input, context) {
    const workspace = new WorkspaceManager(context.workspaceRoot, context.workspace?.additionalRoots ?? []);
    try {
      const { absolute, relative, root } = workspace.resolve(input.path);
      const content = fs.readFileSync(absolute, 'utf-8');
      if (!content.includes(input.oldString)) {
        return failure('STALE_CONTENT', `oldString not found in ${relative}; file may have changed`);
      }
      const newContent = content.split(input.oldString).join(input.newString);
      context.checkpointManager?.record({
        operation: 'edit_file',
        relativePath: relative,
        rootId: root,
        originalContent: content,
        newContent,
      });
      fs.writeFileSync(absolute, newContent, 'utf-8');
      workspace.markChangedResolved({ absolute, relative, root });
      return success(
        { replacements: content.split(input.oldString).length - 1 },
        { affectedFiles: [toFileRef(root, relative)] }
      );
    } catch (error) {
      return failure('EDIT_ERROR', error instanceof Error ? error.message : String(error));
    }
  },
};
