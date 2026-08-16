# Sessions and Persistence

## Overview

Venice Agent maintains durable, atomic sessions that record conversation turns, tool invocations, modified files, active todos, and checkpoints.

## Session Lifecycle

- **Creation**: A unique UUID session is initialized when starting an agent objective.
- **Persistence**: Sessions are saved under `~/.venice/sessions/<session-id>/` (or platform config directory) in restricted-permission files (`0o600`).
- **Events Log**: Fine-grained JSONL telemetry (`events.jsonl`) logs all runtime transitions for offline auditability and debugging.

## Session Management Commands

In the interactive TUI:
- `/sessions`: List saved sessions in the current workspace.
- `/resume`: Open the interactive session picker.
- `/resume <session-id>`: Resume a specific session directly.
- `/new`: Reset conversation context and begin a fresh session.

Via CLI subcommands:
```bash
# List sessions
venice sessions

# Resume a specific session
venice resume <session-id>
```

## Workspace Scoping

Session storage is strictly scoped to the canonical workspace where it was created. Resuming a session created in a different workspace path is rejected to prevent cross-project state corruption.
