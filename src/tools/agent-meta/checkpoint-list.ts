import type { AgentTool } from '../types.js';
import { success } from '../result.js';

export const checkpointListTool: AgentTool<Record<string, never>, unknown> = {
  name: 'checkpoint_list',
  description: 'List available checkpoints for the current session.',
  inputSchema: { type: 'object', properties: {} },
  risk: 'read',
  async execute(_input, context) {
    return success(context.checkpointManager?.list() ?? []);
  },
};
