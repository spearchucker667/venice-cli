/**
 * ask_user tool — request input or a decision from the user.
 *
 * The tool itself emits a structured question; the runtime intercepts the
 * result and collects a real answer through the installed user-question
 * handler (TUI prompt) before returning it to the model (VC-KIMI-058).
 */

import type { AgentTool } from '../types.js';
import { success } from '../result.js';

export interface AskUserInput {
  question: string;
  options?: string[];
  multiSelect?: boolean;
}

export interface AskUserResult {
  question: string;
  options?: string[];
  multiSelect?: boolean;
  answers?: string[];
}

export const askUserTool: AgentTool<AskUserInput, AskUserResult> = {
  name: 'ask_user',
  description: 'Ask the user a question or request a decision. Returns the user\u2019s actual answer.',
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string' },
      options: { type: 'array', items: { type: 'string' }, description: 'Optional choices; the user picks one (or several with multiSelect)' },
      multiSelect: { type: 'boolean', description: 'Allow selecting multiple options' },
    },
    required: ['question'],
  },
  risk: 'read',
  async execute(input, _context) {
    const result: AskUserResult = { question: input.question };
    if (input.options) result.options = input.options;
    if (input.multiSelect) result.multiSelect = true;
    return success(result);
  },
  effects(result) {
    if (!result.ok || !result.data || typeof result.data !== 'object' || !('question' in result.data)) return [];
    const question = result.data as AskUserResult;
    return [{
      type: 'askUser',
      question: question.question,
      ...(question.options ? { options: question.options } : {}),
      ...(question.multiSelect ? { multiSelect: question.multiSelect } : {}),
    }];
  },
};
