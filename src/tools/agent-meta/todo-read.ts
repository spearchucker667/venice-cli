/**
 * todo_read tool — read the current todo list from runtime state.
 */

import type { AgentTool } from '../types.js';
import { success } from '../result.js';
import type { TodoItem } from '../../agent/types.js';

export const todoReadTool: AgentTool<Record<string, never>, TodoItem[]> = {
  name: 'todo_read',
  description: 'Read the current todo list from runtime state.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  risk: 'read',
  async execute(_input, context) {
    return success(context.runtimeState.todos);
  },
};
