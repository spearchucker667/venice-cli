# ADR-004: Terminal UI Architecture Using Ink and React 18

## Status

Accepted

## Context

The interactive agent required a modern, reactive terminal UI supporting live transcript rendering, interactive approval prompts, model and session pickers, status telemetry, and responsive input composition without flickering.

## Decision

We chose **Ink (React for CLI)**:

1. **Component Architecture**: Structured modular components (`App`, `Transcript`, `Composer`, `StatusBar`, `ApprovalPrompt`, `ModelPicker`, `SessionPicker`).
2. **Dual-Stage Signal Handling**: Handled `Ctrl+C` with a two-stage strategy: the first press cancels active background tool/model operations via `AbortController` and returns the UI to idle; the second press exits cleanly.
3. **Streamlined Rendering**: Real-time progress updates are delivered through an `EventBus` subscriber that appends messages without full re-renders of previous transcript history.
4. **Fallback Mode**: When running in non-TTY or `--no-interactive` environments, the TUI is bypassed in favor of `AgentRenderer` or clean JSON output to stdout.

## Consequences

- **Positive**: Declarative UI development matching modern web paradigms.
- **Positive**: Rich interactive components (pickers, approval prompts, dynamic status line).
- **Negative**: React and Ink introduce additional package weight and strict lifecycle constraints.
