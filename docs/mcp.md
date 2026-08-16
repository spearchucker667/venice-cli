# Model Context Protocol (MCP) Integration

## Overview

The Venice Agent natively supports external tool extension via the Model Context Protocol (MCP).

## Configuration

MCP servers are configured in JSON configuration files:

- **Global Config**: `~/.venice/mcp.json`
- **Workspace Config**: `.venice/mcp.json`

Example configuration:

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

## Tool Namespacing

Discovered MCP tools are integrated into the central `ToolRegistry` under the namespace:

```
mcp:<server_name>:<tool_name>
```

Example: `mcp:memory:read_graph`

## CLI Commands

```bash
# List configured MCP servers
venice mcp list

# Check MCP server status in TUI
/mcp
```
