/**
 * Agent tool: list discovered skills.
 */

import type { AgentTool } from '../types.js';
import { success } from '../result.js';

export const skillListTool: AgentTool<Record<string, never>, unknown> = {
  name: 'skill_list',
  description: 'List discovered skills with metadata. Call skill_load to activate a skill.',
  inputSchema: { type: 'object', properties: {} },
  risk: 'read',
  async execute(_input, context) {
    return success(context.runtimeState.skillSummaries ?? []);
  },
};
