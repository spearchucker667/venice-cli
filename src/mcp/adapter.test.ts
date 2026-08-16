import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createMcpToolAdapter } from './adapter.js';
import type { ToolContext } from '../tools/types.js';
import { defaultMode } from '../agent/mode.js';

describe('createMcpToolAdapter', () => {
  it('namespaces tool name and forwards call', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const context: ToolContext = {
      workspaceRoot: '/tmp',
      sessionId: 's',
      objective: 'o',
      runtimeState: { sessionId: 's', workspaceRoot: '/tmp', workspace: { primaryRoot: '/tmp', additionalRoots: [] }, model: 'm', objective: 'o', status: 'idle', mode: defaultMode(), messages: [], todos: [], relevantFiles: [], changedFiles: [], toolHistory: [], skillSummaries: [], activeSkills: [] },
    };
    const adapter = createMcpToolAdapter('memory', {
      name: 'add',
      description: 'Add memory',
      inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
    }, async (name, args) => {
      calls.push({ name, args });
      return { ok: true };
    });

    assert.strictEqual(adapter.name, 'mcp:memory:add');
    assert.strictEqual(adapter.risk, 'external_side_effect');
    assert.strictEqual(adapter.planSafe, false);
    const result = await adapter.execute({ key: 'x' }, context);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(calls, [{ name: 'add', args: { key: 'x' } }]);
  });

  it('returns a failure when callTool throws', async () => {
    const context: ToolContext = {
      workspaceRoot: '/tmp',
      sessionId: 's',
      objective: 'o',
      runtimeState: { sessionId: 's', workspaceRoot: '/tmp', workspace: { primaryRoot: '/tmp', additionalRoots: [] }, model: 'm', objective: 'o', status: 'idle', mode: defaultMode(), messages: [], todos: [], relevantFiles: [], changedFiles: [], toolHistory: [], skillSummaries: [], activeSkills: [] },
    };
    const adapter = createMcpToolAdapter('memory', { name: 'fail' }, async () => {
      throw new Error('boom');
    });
    const result = await adapter.execute({}, context);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error?.code, 'MCP_TOOL_ERROR');
    assert.ok(result.error?.message.includes('boom'));
  });
});
