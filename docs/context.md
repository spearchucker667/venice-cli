# Context Management and Compaction

## Overview

The `ContextManager` ensures that model context stays within token limits while preserving essential task objectives, constraints, file modifications, and failures.

## Context Layers

Context is constructed hierarchically:

1. **System Contract**: Centralized rules of engagement, output format contracts, and safety invariants.
2. **Project Instructions**: Resolved instructions from `AGENTS.md`, `VENICE.md`, `.venice/instructions.md`, or path-scoped rules.
3. **Working Memory**: Objective, active todos, decisions, known failures, and changed files.
4. **Active Skills**: Compact summaries or loaded instructions of relevant skills.
5. **Conversation & Tool History**: Recent user/assistant messages and tool results.
6. **Structured Summary**: Compact summary of older turns when compaction threshold is reached.

## Context Compaction

When the estimated token count approaches the configured budget threshold (default 75% of context window):
- A `StructuredSummary` is compiled summarizing completed work, discoveries, and command executions.
- Older messages and bulky tool outputs are pruned.
- The primary objective, unresolved failures, user constraints, and changed file list are **never** discarded.
- Manual compaction can be triggered anytime in the TUI using `/compact`.
