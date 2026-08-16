/**
 * Agent tool: load a skill by name.
 *
 * Returns the full body of the skill. The runtime should mark the skill as active
 * so its instructions remain in context for subsequent turns.
 */

import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';

export const skillLoadTool: AgentTool<{ name: string }, unknown> = {
  name: 'skill_load',
  description: 'Load a skill by name and return its full instructions.',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  },
  risk: 'read',
  async execute(input, context) {
    const name = String(input.name || '');
    const skill = context.skillRegistry?.load(name);
    if (!skill) {
      return failure('SKILL_NOT_FOUND', `Skill '${name}' not found`);
    }
    return success({
      name: skill.name,
      description: skill.description,
      tools: skill.tools,
      content: skill.content,
    });
  },
};
