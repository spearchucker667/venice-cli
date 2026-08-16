# Configuration Reference

## Hierarchy and Precedence

Venice CLI configuration resolves with the following precedence:

1. CLI Arguments & Flags (Highest)
2. Environment Variables (`VENICE_API_KEY`, etc.)
3. Workspace Configuration (`.venice/config.json`)
4. Global User Configuration (`~/.config/venice/config.json`)
5. Built-in Defaults (Lowest)

## Workspace Initialization

Scaffold workspace configuration and instructions using:

```bash
venice init
```

This creates:
- `.venice/config.json`: Workspace agent configuration.
- `.venice/instructions.md`: Custom instructions for the repository.
- `.venice/mcp.json`: Workspace MCP server declarations.
- `.venice/skills/`: Workspace-specific skill definitions.

## Configuration Schema

```json
{
  "agent": {
    "defaultModel": "kimi-k2.5",
    "approvalMode": "suggest",
    "maxTurns": 25
  },
  "context": {
    "autoCompact": true,
    "compactionThreshold": 0.75
  }
}
```
