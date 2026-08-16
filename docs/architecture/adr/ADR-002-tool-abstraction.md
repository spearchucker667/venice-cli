# ADR-002: Unified Tool Abstraction and Risk Classification

## Status

Accepted

## Context

The agent runtime requires diverse tools spanning filesystem manipulation, shell execution, Git inspection, MCP servers, skills, and Venice-native media/search APIs. Without a unified interface, tool execution, safety sandboxing, approval checks, and result formatting become fragmented.

## Decision

We defined a normalized `AgentTool<TInput, TOutput>` interface and `ToolRegistry`:

1. **Uniform Interface**: Every tool provides `name`, `description`, JSON-schema `inputSchema`, categorized `risk` (`read`, `write`, `execute`, `network`, `destructive`), and an `execute(input, context)` method returning `ToolResult<TOutput>`.
2. **Execution Context**: Tools receive a scoped `ToolContext` providing canonical `workspaceRoot`, `sessionId`, `objective`, and `runtimeState`.
3. **Structured Results**: Tool execution returns `{ ok, data, error, metadata }` without throwing unhandled exceptions. Truncation flags and affected file paths are captured in `metadata`.
4. **Registry Architecture**: `ToolRegistry` handles tool lookup, namespace isolation (e.g. `mcp:<server>:<tool>`), and conversion to OpenAI-compatible function calling schemas for the model client.

## Consequences

- **Positive**: Consistent schema validation and serialization across built-in, MCP, and skill tools.
- **Positive**: Centralized permission and approval evaluation before tool execution.
- **Positive**: Clear boundaries preventing tools from directly manipulating UI or global process state.
- **Negative**: All tool arguments and outputs must conform to JSON-serializable types.
