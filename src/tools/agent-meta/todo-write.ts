/**
 * todo_write tool — replace the current todo list.
 *
 * The tool itself does not mutate runtime state directly; it returns the
 * desired list so the runtime can apply the change.
 */

import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';
import type { TodoItem } from '../../agent/types.js';

export const todoWriteTool: AgentTool<{ todos: TodoItem[] }, TodoItem[]> = {
  name: 'todo_write',
  description: 'Replace the current todo list with a new list.',
  inputSchema: {
    type: 'object',
    properties: {
      todos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            content: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'blocked'] },
          },
          required: ['id', 'content', 'status'],
        },
      },
    },
    required: ['todos'],
  },
  risk: 'write',
  async execute(input, _context) {
    if (!Array.isArray(input.todos)) {
      return failure('INVALID_TODOS', 'todos must be an array');
    }
    for (const todo of input.todos) {
      if (!todo.id || typeof todo.content !== 'string') {
        return failure('INVALID_TODO', 'Each todo must have id and content');
      }
      if (!['pending', 'in_progress', 'completed', 'blocked'].includes(todo.status)) {
        return failure('INVALID_TODO_STATUS', `Invalid status: ${todo.status}`);
      }
    }
    return success(input.todos);
  },
  effects(result) {
    if (!result.ok || !result.data) return [];
    return [{ type: 'setTodos', todos: result.data }];
  },
};
