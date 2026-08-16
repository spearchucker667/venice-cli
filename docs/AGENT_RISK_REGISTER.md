# Venice CLI Agent Runtime — Comprehensive Risk Register

## 1. Risk Matrix Overview

This register identifies, evaluates, and documents operational and security mitigations for the Venice CLI Agent Runtime.

---

## 2. Risk Evaluation Table

| ID | Risk Description | Severity | Likelihood | Mitigation Strategy | Verification / Test |
|---|---|---|---|---|---|
| **RSK-01** | **Workspace Escape / Path Traversal**<br>Agent attempts to read/write files outside the workspace root (e.g. `~/.ssh`, `/etc/passwd`, `../`). | High | Low | `WorkspaceManager` canonicalizes all paths, resolves symlinks, and enforces that target realpaths reside within `workspaceRoot`. External operations throw immediately. | `src/agent/workspace.test.ts`, `src/tools/filesystem/filesystem.test.ts` |
| **RSK-02** | **Destructive Shell Commands**<br>Model attempts hazardous commands (e.g. `rm -rf /`, `mkfs`, system reboots). | Critical | Low | Shell execution checks against a blocked command pattern list. Even in `yolo` mode, destructive patterns are strictly blocked from execution. | `src/agent/permissions.test.ts`, `src/tools/shell/execute.test.ts` |
| **RSK-03** | **Context Window Overflow**<br>Large files or extensive tool history exceed the model's token limits. | Medium | Medium | Dynamic context budget calculation via Venice model metadata. Automatic `StructuredSummary` compaction triggers at 75% utilization. Large file reads are capped with offset support. | `src/agent/context.test.ts`, `src/tools/filesystem/filesystem.test.ts` |
| **RSK-04** | **Secret & Credential Leakage**<br>API keys, passwords, or tokens are logged to session transcripts or context. | High | Low | Session persistence redacts authorization headers, API keys, and environment variables matching sensitive patterns (`VENICE_API_KEY`, `AWS_SECRET_*`, private keys). | `src/agent/sessions.test.ts`, `src/lib/output.sanitize.test.ts` |
| **RSK-05** | **MCP Server Hijack / Untrusted Tools**<br>Third-party MCP servers expose untrusted or hazardous capabilities. | High | Medium | MCP tools are namespaced (`mcp:<server>:<tool>`), default to `execute` risk level, and require explicit user approval. Server failures are isolated without crashing the agent. | `src/mcp/client.test.ts`, `src/mcp/manager.test.ts` |
| **RSK-06** | **Orphaned Child Processes**<br>Long-running shell commands or MCP servers persist after agent exit or cancellation. | Medium | Low | Shell execution registers process tracking and kills process groups on timeout or SIGINT. MCP manager stops child processes during teardown. | `src/tools/shell/execute.test.ts`, `src/mcp/client.test.ts` |
| **RSK-07** | **False Validation Success**<br>Agent claims a build or test succeeded when it actually failed. | High | Low | Post-edit validation executes actual project toolchain commands (`npm test`, `cargo check`, etc.) and injects real exit codes and stdout into model working memory. | `src/agent/validation.test.ts`, `src/tools/validation/run.test.ts` |
| **RSK-08** | **Stale File Edit Conflicts**<br>Concurrent modifications or multiple edits on outdated file versions cause data loss. | Medium | Low | Checkpoint manager records file snapshots prior to every mutation, enabling atomic multi-step undo/redo. `edit_file` checks for exact target string matching. | `src/agent/checkpoints.test.ts`, `src/tools/filesystem/filesystem.test.ts` |
| **RSK-09** | **Subagent Write Conflicts**<br>Subagents inadvertently overwrite parent work or spawn recursive write loops. | High | Low | Read-only is the default subagent mode. Write subagents receive a restricted, shell-free toolset, share the parent checkpoint manager, and cannot spawn recursive subagents. | `src/agent/subagents.test.ts`, `src/tools/agent-meta/spawn-agent.test.ts` |
| **RSK-10** | **Rate Limiting & Transient API Errors**<br>Venice API returns 429 or 5xx during agent iterations. | Medium | Medium | Exponential backoff and retry policy in model client. Errors are reported as structured failures to allow the agent to wait or summarize gracefully. | `src/agent/model-client.test.ts` |
| **RSK-11** | **Cross-Platform Path & Shell Discrepancies**<br>Windows CRLF / backslashes vs POSIX paths causing execution failures. | Medium | Low | Path normalization via `node:path`, cross-platform platform detection for shell execution (`sh` on POSIX, `powershell`/`cmd` on Windows). | `src/agent/workspace.test.ts`, `src/tools/shell/execute.test.ts` |
| **RSK-12** | **Terminal UI Glitches & ANSI Bleed**<br>Ink/React TUI hangs or fails in non-TTY environments. | Low | Low | Headless fallback: noninteractive execution runs if stdin/stdout is not a TTY or when `--no-interactive` / `--json` is supplied. | `src/commands/agent.test.ts`, `src/ui/renderer.test.ts` |
