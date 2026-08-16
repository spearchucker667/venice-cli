# ADR-001: Agent Runtime Boundary and UI Decoupling

## Status

Accepted

## Context

The Venice CLI needed to evolve from a simple interactive chat and API utility into a complete workspace-aware coding agent runtime. A common antipattern in terminal AI tools is embedding agent orchestration, tool execution, and state management directly inside React/Ink components or command action handlers (e.g. inflating `chat.ts`).

## Decision

We established a strict architectural boundary separating the core agent runtime from the user interface and transport layers:

1. **`AgentRuntime` is the single source of truth**: It encapsulates the execution loop, manages `AgentState`, handles context budgeting/compaction, invokes tools via `ToolRegistry`, applies permission checks via `PermissionManager`, detects validation commands, and records events.
2. **Terminal UI is a pure presentation subscriber**: The React/Ink interface (`App`, `Transcript`, `Composer`, `StatusBar`) subscribes to the append-oriented `EventBus` and issues user commands to `AgentRuntime`. The UI layer contains zero business logic, tool execution code, or permission evaluation algorithms.
3. **Headless/Interactive Parity**: Non-interactive command runs (`venice agent -p "..."`) and interactive TUI sessions (`venice`) execute through the exact same `AgentRuntime` engine.

## Consequences

- **Positive**: Complete independent testability of the agent loop without terminal mocks.
- **Positive**: Robust headless CI/CD automation and JSON output support.
- **Positive**: Clean state transitions and consistent safety/permission enforcement across interfaces.
- **Negative**: Requires explicit event mapping and state synchronization between the runtime and UI components.
