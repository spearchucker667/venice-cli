import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createMcpToolAdapter, MAX_MCP_SCHEMA_BYTES } from './adapter.js';
import { compileToolSchema } from '../lib/tool-schema.js';
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

  it('caps oversized MCP schemas instead of compiling them (VCL-R3-005)', () => {
    const bigSchema = {
      type: 'object',
      properties: { data: { type: 'string', description: 'x'.repeat(MAX_MCP_SCHEMA_BYTES) } },
    };
    const adapter = createMcpToolAdapter('server', { name: 't', inputSchema: bigSchema }, async () => ({}));
    assert.deepStrictEqual(adapter.inputSchema, { type: 'object', properties: {} });
  });

  it('normalizes isError:true results into explicit failures (VCL-R3-016)', async () => {
    const context: ToolContext = {
      workspaceRoot: '/tmp',
      sessionId: 's',
      objective: 'o',
      runtimeState: { sessionId: 's', workspaceRoot: '/tmp', workspace: { primaryRoot: '/tmp', additionalRoots: [] }, model: 'm', objective: 'o', status: 'idle', mode: defaultMode(), messages: [], todos: [], relevantFiles: [], changedFiles: [], toolHistory: [], skillSummaries: [], activeSkills: [] },
    };
    const structured = {
      isError: true,
      content: [{ type: 'text', text: 'division by zero' }],
      structuredContent: { ok: false, reason: 'div0' },
    };
    const adapter = createMcpToolAdapter('calc', { name: 'divide' }, async () => structured);
    const result = await adapter.execute({}, context);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error?.code, 'MCP_TOOL_REPORTED_ERROR');
    assert.strictEqual(result.error?.message, 'division by zero');
    // The structured payload stays available to the model.
    assert.deepStrictEqual(result.error?.details, structured);
  });

  it('keeps structuredContent on successful results (VCL-R3-021)', async () => {
    const context: ToolContext = {
      workspaceRoot: '/tmp',
      sessionId: 's',
      objective: 'o',
      runtimeState: { sessionId: 's', workspaceRoot: '/tmp', workspace: { primaryRoot: '/tmp', additionalRoots: [] }, model: 'm', objective: 'o', status: 'idle', mode: defaultMode(), messages: [], todos: [], relevantFiles: [], changedFiles: [], toolHistory: [], skillSummaries: [], activeSkills: [] },
    };
    const structured = { content: [], structuredContent: { rows: [1, 2, 3] } };
    const adapter = createMcpToolAdapter('db', { name: 'query' }, async () => structured);
    const result = await adapter.execute({}, context);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.data, structured);
  });

  it('models title, outputSchema, and annotations as untrusted metadata (VCL-R3-021)', async () => {
    const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
    const adapter = createMcpToolAdapter(
      'server',
      {
        name: 't',
        title: 'My Tool',
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: { id: { type: 'string' } } },
        annotations,
      },
      async () => ({})
    );
    assert.strictEqual(adapter.title, 'My Tool');
    assert.deepStrictEqual(adapter.outputSchema, {
      type: 'object',
      properties: { id: { type: 'string' } },
    });
    // Annotations are surfaced read-only and never influence risk.
    assert.deepStrictEqual(adapter.untrustedMetadata, annotations);
    assert.strictEqual(adapter.risk, 'external_side_effect');
  });
});

describe('compileToolSchema hardening (VCL-R3-005)', () => {
  it('rejects remote $ref loading without fetching', () => {
    // AJV cannot resolve an external reference and throws at compile time;
    // the schema is never fetched and the tool is unusable.
    assert.throws(
      () =>
        compileToolSchema({
          type: 'object',
          properties: { a: { $ref: 'https://evil.example/schema.json' } },
        }),
      /can't resolve reference/
    );
  });
});
