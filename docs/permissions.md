# Permissions and Security Boundaries

## Overview

The Venice Agent runtime enforces explicit risk classification and multi-level approval policies to guarantee user control over file edits, shell commands, network access, and external workspace interactions.

## Risk Categories

Every tool is statically assigned a risk classification:

- **`read`**: Safe inspection of workspace files, search, Git status, and metadata.
- **`write`**: Creation, modification, patching, or deletion of workspace files.
- **`execute`**: Execution of shell commands, scripts, or validation suites.
- **`network`**: External network calls (e.g. Venice media generation, web search, MCP).
- **`destructive`**: Irreversible system commands or broad filesystem deletions.

## Approval Modes

The approval mode is set at startup via `--approval <mode>` or `.venice/config.json`:

| Mode | Reads | Workspace Edits | Shell Commands | Network/MCP | Destructive |
|---|---|---|---|---|---|
| **`suggest`** (Default) | Allowed | Prompt | Prompt | Prompt | Prompt |
| **`auto-edit`** | Allowed | Allowed | Prompt | Prompt | Prompt |
| **`auto`** | Allowed | Allowed | Allowed (Safe) | Allowed | Prompt |
| **`yolo`** | Allowed | Allowed | Allowed | Allowed | Prompt |

## Safety Constraints

Regardless of the active approval mode:
1. **Workspace Boundary**: Path traversal (`../`), symlinks escaping the workspace, and absolute external paths are strictly prohibited without explicit user approval.
2. **Destructive Shell Commands**: High-risk commands (`rm -rf /`, formatting drives, credential exposure) are always intercepted and require confirmation.
3. **Secret Redaction**: Sensitive files (`.env`, private keys) are protected from accidental leakage into context transcripts.
