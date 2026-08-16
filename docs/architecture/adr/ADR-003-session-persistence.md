# ADR-003: Durable Session Persistence and Workspace Isolation

## Status

Accepted

## Context

Agents need durable state across executions to support resumption (`/resume`, `venice resume`), auditability, debugging, and crash recovery. Sessions must not leak credentials or allow cross-workspace contamination.

## Decision

We implemented `SessionManager` with atomic file persistence and strict workspace sandboxing:

1. **Storage Structure**: Sessions are persisted under `~/.venice/sessions/<session-id>/` (or platform config directory) containing `session.json`, `events.jsonl`, `summary.json`, and `checkpoints/`.
2. **Atomic Writes**: State files are written to `.tmp` files with `0o600` permissions and atomically renamed via `fs.renameSync` to avoid corruption during unexpected exits.
3. **Canonical Workspace Scoping**: Every session records its canonical `workspaceRoot`. Listing (`/sessions`) filters by current workspace, and resume operations reject loading sessions from other workspaces.
4. **Secret Redaction**: Session transcripts sanitize known API keys and credentials before disk persistence.

## Consequences

- **Positive**: Resilient state persistence safe against sudden process termination.
- **Positive**: Complete separation of workspace history preventing cross-project context pollution.
- **Negative**: Resuming sessions in renamed directories requires re-canonicalization.
