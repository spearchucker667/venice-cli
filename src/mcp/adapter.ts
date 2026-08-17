import type { AgentTool, ToolContext } from '../tools/types.js';
import type { ToolResult } from '../agent/types.js';
import type { McpTool } from './client.js';

export type McpCallToolFn = (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;

export function createMcpToolAdapter(
  serverName: string,
  tool: McpTool,
  callTool: McpCallToolFn
): AgentTool {
  const namespacedName = `mcp:${serverName}:${tool.name}`;
  return {
    name: namespacedName,
    description:
      tool.description || `MCP tool '${tool.name}' from server '${serverName}'`,
    inputSchema: normalizeSchema(tool.inputSchema),
    risk: 'external_side_effect',
    planSafe: false,
    parallelSafe: false,
    async execute(input: unknown, context: ToolContext): Promise<ToolResult<unknown>> {
      try {
        const args =
          typeof input === 'object' && input !== null
            ? (input as Record<string, unknown>)
            : {};
        const result = await callTool(tool.name, args, context.signal);
        return { ok: true, data: result };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'MCP_TOOL_ERROR',
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  };
}

/**
 * Maximum serialized size of an MCP tool schema. Schemas are untrusted server
 * input; capping the size prevents a malicious server from forcing unbounded
 * memory/time during validation compilation (VCL-R3-005).
 */
export const MAX_MCP_SCHEMA_BYTES = 256 * 1024;

function normalizeSchema(schema: unknown): AgentTool['inputSchema'] {
  if (
    schema &&
    typeof schema === 'object' &&
    (schema as Record<string, unknown>).type === 'object'
  ) {
    // Oversized schemas fall back to unvalidated input rather than being
    // compiled (the tool stays usable; its args are not schema-checked).
    const size = Buffer.byteLength(JSON.stringify(schema));
    if (size <= MAX_MCP_SCHEMA_BYTES) {
      return schema as AgentTool['inputSchema'];
    }
  }
  return { type: 'object', properties: {} };
}
