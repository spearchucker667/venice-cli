# ADR-005: Model Context Protocol (MCP) Integration and Fault Isolation

## Status

Accepted

## Context

The agent must support extensibility through the Model Context Protocol (MCP) to allow custom tool integrations (e.g. database clients, memory servers, browser automation). MCP servers run as independent child processes that can fail or hang.

## Decision

We designed the `McpManager` and stdio JSON-RPC transport layer:

1. **Process Isolation**: Each configured MCP server runs as an independent child process via stdio transport.
2. **Namespace Partitioning**: Discovered tools are normalized into the agent's `ToolRegistry` with the namespace `mcp:<server_name>:<tool_name>` to prevent collisions with built-in tools.
3. **Hierarchical Configuration**: Config is resolved by merging global `~/.venice/mcp.json` with workspace-specific `.venice/mcp.json`.
4. **Fault Tolerance**: A server crash or startup timeout is isolated; its tools are disabled and an error is logged without terminating the main agent runtime.

## Consequences

- **Positive**: Seamless integration with the standard MCP ecosystem.
- **Positive**: Complete fault containment preventing external tool crashes from killing the agent.
- **Negative**: Adds child process lifecycle management and stdio buffer serialization overhead.
