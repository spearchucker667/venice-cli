# Phase 7 — Full Interactive Terminal UI Design

## Purpose

Replace the simple event-driven `AgentRenderer` with a keyboard-driven, full-screen terminal UI for `venice agent`. The TUI must render the agent transcript, a persistent composer, tool/approval events, streaming assistant text, and a status line, while keeping all business logic in the existing runtime.

## Scope

### In scope for this phase

- Full-screen Ink/React TUI launched automatically when `venice` or `venice agent` runs in an interactive TTY and `--json` is not used.
- Persistent bottom composer with text input, submit, and keyboard shortcuts.
- Scrollable transcript showing user messages, assistant streaming text, tool calls, tool results, approvals, file changes, and errors.
- Inline approval prompts that block the runtime until the user chooses Yes/Always/No.
- Status bar showing model, workspace, approval mode, context usage estimate, and session state.
- `/`-slash commands (`/help`, `/model`, `/status`, `/context`, `/compact`, `/clear`, `/new`, `/resume`, `/sessions`, `/tools`, `/mcp`, `/skills`, `/permissions`, `/plan`, `/diff`, `/review`, `/git`, `/init`, `/quit`).
- `@` file mentions in the composer that expand into workspace-relative paths for the next message.
- `!` shell passthrough that runs commands through the same controlled shell executor.
- Reliable Ctrl+C handling: first cancels the current operation; second exits the session cleanly.
- A `--no-interactive` CLI flag to force the existing non-TTY renderer output.
- Tests for TUI state management and components using `ink-testing-library`.

### Out of scope for this phase

- Mouse support.
- Inline image/media previews.
- Rich diff/side-by-side code review panes.
- Multi-pane layouts beyond a single transcript + composer + status bar.
- Theme customization beyond the existing chalk-based palette.

## Architecture

```text
User input (keyboard)  →  TUI App state  →  Composer / Slash parser / Approval prompt
                                ↓
                        AgentRuntime event bus
                                ↓
                        Transcript / StatusBar / ToolCall components
```

- `src/ui/app.tsx` — top-level Ink component. Owns the `AgentRuntime` lifecycle, event subscription, TUI state, and user input routing.
- `src/ui/transcript.tsx` — renders the scrollable message/event history.
- `src/ui/composer.tsx` — persistent text input with support for `@` mentions, `!` shell passthrough, and `/` slash commands.
- `src/ui/tool-call.tsx` — renders a tool request, execution spinner, and result.
- `src/ui/approval.tsx` — modal prompt for permission approval.
- `src/ui/status.tsx` — status bar with model, workspace, context usage, and session state.
- `src/ui/slash-commands.ts` — slash command registry and handler dispatch.
- `src/ui/mentions.ts` — file mention parser/resolver.
- `src/ui/renderer.tsx` — refactored to choose between Ink TUI and the existing plain console renderer based on environment and flags.

The existing `AgentRuntime`, `EventBus`, `PermissionManager`, `ContextManager`, and tool registry remain unchanged. The TUI consumes events and drives the runtime through its public API.

## Data Flow

1. `venice agent` (or bare `venice`) detects a TTY, chooses interactive mode, and starts the Ink app.
2. The app creates `AgentRuntime` with the user's objective and a `PermissionManager` whose approver callback renders an `Approval` prompt and resolves on user input.
3. Runtime events (`model_request`, `assistant_delta`, `tool_requested`, `tool_completed`, `approval_requested`, `file_changed`, etc.) update a reactive `useState` transcript in the app.
4. Composer submissions append a user message to the transcript and either start a new runtime run or, if a run is active, inject the message as a new user turn.
5. Slash commands are parsed from the composer text before submission and dispatched to handlers that may mutate state or emit system messages.
6. File mentions are resolved to workspace-relative paths and attached as explicit file context to the next runtime turn.
7. Shell passthrough captures the command, runs it through the controlled shell tool, and displays the result in the transcript without sending it to the model unless the user chooses.
8. First Ctrl+C aborts the current `AbortController`; second Ctrl+C unmounts the app and exits.

## Dependencies

Add to `dependencies`:

- `ink` — React-based terminal UI framework.
- `react` — peer dependency of Ink.
- `ink-text-input` — text input component for the composer.
- `ink-select-input` — selection component for approval prompts and slash menus.

Add to `devDependencies`:

- `@types/react` — TypeScript types for React.
- `ink-testing-library` — render and interact with Ink components in tests.

No other runtime dependencies are added. The existing strict TypeScript configuration remains.

## Testing Strategy

- Unit tests for `slash-commands.ts` and `mentions.ts` using `node:test`.
- Component tests for `composer.tsx`, `approval.tsx`, and `transcript.tsx` using `ink-testing-library`.
- Integration test for `renderer.tsx` choosing TUI vs plain renderer based on `process.stdin.isTTY` and flags.
- The runtime tests from Phase 6 continue to pass without modification.

## Backwards Compatibility

- Non-interactive execution (`--prompt`, piped stdin, `--json`, non-TTY stdout) uses the existing plain renderer unchanged.
- The `--interactive` flag remains but becomes the default in TTY environments; `--no-interactive` forces plain output.
- Existing agent tests that do not depend on TTY remain unaffected.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Ink adds significant bundle/install weight | Keep dependency set minimal; evaluate alternatives only if install size is prohibitive. |
| Terminal corruption on exit | Use Ink's `useApp` `exit` handler and restore raw mode on unmount; ensure cleanup runs on SIGINT. |
| Approval prompt blocks the event loop | Implement the approver callback as a promise resolved by the Ink component; runtime `await`s it. |
| Large transcripts hurt render performance | Cap rendered transcript length and offer `/compact` or auto-truncate. |
| Cross-platform key handling | Use Ink's normalized `useInput`; avoid raw stdin key parsing. |
