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
    title: tool.title,
    description:
      tool.description || `MCP tool '${tool.name}' from server '${serverName}'`,
    inputSchema: normalizeSchema(tool.inputSchema),
    outputSchema: normalizeSchema(tool.outputSchema),
    // Annotations are server-supplied metadata and are surfaced read-only;
    // they never influence risk classification or permissions (VCL-R3-021).
    untrustedMetadata: tool.annotations,
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
        // A logical tool failure may still be a valid JSON-RPC result
        // (isError:true). Normalize it into an explicit failure while keeping
        // the structured payload (including any structuredContent) available
        // to the model (VCL-R3-016).
        if (isErrorResult(result)) {
          return {
            ok: false,
            error: {
              code: 'MCP_TOOL_REPORTED_ERROR',
              message: extractMcpError(result),
              details: result,
            },
          };
        }
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

/** True when an MCP tool result is a logical failure (isError:true). */
function isErrorResult(result: unknown): boolean {
  return (
    typeof result === 'object' &&
    result !== null &&
    (result as Record<string, unknown>).isError === true
  );
}

/**
 * Extract a readable error message from an isError:true result. Prefers an
 * explicit message field, then concatenated text content blocks, then a
 * JSON fallback.
 */
export function extractMcpError(result: unknown): string {
  if (typeof result !== 'object' || result === null) return 'MCP tool reported an error';
  const record = result as Record<string, unknown>;
  if (typeof record.message === 'string' && record.message.trim()) {
    return record.message.trim();
  }
  if (Array.isArray(record.content)) {
    const texts = record.content
      .filter(
        (block): block is { type: string; text?: unknown } =>
          typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'text'
      )
      .map((block) => (typeof block.text === 'string' ? block.text : ''))
      .filter((text) => text.trim());
    if (texts.length) return texts.join('\n');
  }
  try {
    return JSON.stringify(result);
  } catch {
    return 'MCP tool reported an error';
  }
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
