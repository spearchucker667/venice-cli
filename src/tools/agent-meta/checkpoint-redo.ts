import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';

export const checkpointRedoTool: AgentTool<Record<string, never>, unknown> = {
  name: 'checkpoint_redo',
  description: 'Redo the most recently undone checkpoint.',
  inputSchema: { type: 'object', properties: {} },
  risk: 'write',
  async execute(_input, context) {
    if (!context.checkpointManager) {
      return failure('NO_CHECKPOINT_MANAGER', 'Checkpoint manager is not available');
    }
    const result = await context.checkpointManager.redo();
    if (!result.ok) {
      return failure('REDO_FAILED', 'Nothing to redo');
    }
    return success(result);
  },
};
