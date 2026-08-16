# Venice Agent Guide

## Overview

The Venice Agent is a workspace-aware, autonomous development assistant designed for software engineering, repository maintenance, and general multimodal tasks. It iteratively reasons, invokes tools, modifies files, runs shell commands, validates work, and manages persistent sessions.

## Starting the Agent

### Interactive TUI Mode

Launch the interactive terminal UI from within any project repository:

```bash
# Bare invocation (defaults to agent in TTY)
venice

# Explicit agent launch
venice agent

# Launch with custom model or approval mode
venice agent --model "kimi-k2.5" --approval auto-edit
```

### Non-Interactive & CI Automation

Execute headless tasks from automation scripts or CI/CD pipelines:

```bash
# Single prompt execution
venice agent -p "Review this repository, fix any broken tests, and verify the build."

# Machine-readable JSON output to stdout
venice agent -p "Inspect package.json and extract the version" --no-interactive --json
```

## Agent Capabilities

- **Workspace Awareness**: Automatically detects Git roots, instruction files (`AGENTS.md`, `VENICE.md`), and project build tools (`npm`, `cargo`, `go`, `gradle`, etc.).
- **Filesystem Tools**: Read, search, edit, patch, and list files safely with strict workspace boundary checks.
- **Controlled Shell**: Run build, test, and lint commands with separate stdout/stderr capture and cancellation support.
- **Git Integration**: Inspect working tree state (`git_status`, `git_diff`, `git_log`) and verify exact changes before concluding tasks.
- **Automatic Validation**: Detects and runs relevant project test/build commands following filesystem edits to verify changes.
- **Checkpoints & Undo**: Tracks file snapshots for undoing and redoing agent modifications (`/undo`, `/redo`).
- **MCP Extensibility**: Connect external tools via Model Context Protocol stdio servers.
- **Progressive Skills**: Load custom domain-specific workflows and prompts on demand.
