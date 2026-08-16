/**
 * ask_user tool — request input or a decision from the user.
 *
 * In a noninteractive runtime this returns a structured request; the runtime
 * or UI layer is responsible for actually collecting the answer.
 */

import type { AgentTool } from '../types.js';
import { success } from '../result.js';

export const askUserTool: AgentTool<{ question: string; options?: string[] }, { question: string; options?: string[] }> = {
  name: 'ask_user',
  description: 'Ask the user a question or request a decision.',
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string' },
      options: { type: 'array', items: { type: 'string' } },
    },
    required: ['question'],
  },
  risk: 'read',
  async execute(input, _context) {
    const result: { question: string; options?: string[] } = { question: input.question };
    if (input.options) result.options = input.options;
    return success(result);
  },
};
