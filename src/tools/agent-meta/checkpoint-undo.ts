import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';

export const checkpointUndoTool: AgentTool<Record<string, never>, unknown> = {
  name: 'checkpoint_undo',
  description: 'Undo the most recent checkpoint.',
  inputSchema: { type: 'object', properties: {} },
  risk: 'write',
  async execute(_input, context) {
    if (!context.checkpointManager) {
      return failure('NO_CHECKPOINT_MANAGER', 'Checkpoint manager is not available');
    }
    const result = await context.checkpointManager.undo();
    if (!result.ok) {
      return failure('UNDO_FAILED', 'Nothing to undo');
    }
    return success(result);
  },
};
