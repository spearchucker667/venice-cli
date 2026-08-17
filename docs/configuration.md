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

The project-scoped `.venice/config.json` schema:

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

## Authentication and API keys

Credentials live in the **global** config (`~/.venice/config.json`), never in a
project-scoped config:

| Key | Purpose |
| --- | --- |
| `api_key` | Primary Venice API key |
| `fallback_api_key` | Secondary key; used automatically when the primary key is missing or rejected (401/403) |
| `signInWithX` | Wallet-token alternative to the API key |

### CLI

```bash
# Set a key (hidden prompt on a TTY, or pipe it in)
venice config set api_key
printf '%s' "$KEY" | venice config set api_key --stdin
venice config set fallback_api_key --stdin

# Inspect (values are masked) / remove
venice config show
venice config unset fallback_api_key
```

### Agent TUI slash commands

The bare `venice` agent can set credentials without leaving the session:

- `/config api-key <key>` — set the primary key. With no value, the TUI shows a
  **masked entry prompt** (typed characters render as `*` and are never echoed
  to the transcript); Escape cancels.
- `/config fallback-api-key <key>` — set the secondary key (same masked prompt
  when the value is omitted).
- `/config clear-api-key` / `/config clear-fallback-api-key` — remove a key.
- `/config` — hub showing masked auth status and the source of the active key.
- `/status` — shows the masked active credential and its source
  (`environment` vs `config` vs `config (fallback)`).

### Fallback behavior

1. **Resolution**: when no primary key is configured, the fallback key is used
   as the active credential.
2. **Retry**: when a request is rejected with 401/403, it is re-issued once
   with the fallback key before the auth error surfaces. This covers the
   main `apiRequest` path (chat, models, search) and the direct-fetch media
   endpoints (image upscale, TTS, voice cloning, transcription, video
   retrieve, document parsing).
3. **Guard**: the retry never fires when the fallback key equals the active
   credential.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `VENICE_API_KEY` | Overrides the stored primary API key |
| `VENICE_API_KEY_FALLBACK` | Overrides the stored fallback key |
