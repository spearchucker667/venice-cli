# Kimi Code Comparative Analysis

## Comparative Findings

| Area | Kimi | Venice | Gap | Decision | Priority |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Startup** | Minimal synchronous work, lazy background worker init, clear telemetry boundary, no hard blocks on cache. | Sync tool load, synchronous agent startup, slightly heavier initial render. | Kimi is slightly more lazy with background cleanup and workers. | ADAPT | 3 |
| **Composer** | Native pi-tui text input with multiline, syntax highlighting, vi-keys, autocomplete, persistent draft. | Ink text input, basic history, standard readline behaviors. | Venice lacks native multiline and advanced syntax rendering in composer. | ADAPT | 1 |
| **History** | Deep history support, stored in minidb or local disk, Up/Down navigation. | Memory-based or simple text-file history, Up/Down navigation just implemented. | History exists but lacks robust multiline persistence. | KEEP VENICE | 1 |
| **Multiline** | Shift+Enter or automatic multiline insertion for pastes. | Basic newline handling via single string. | True multiline editing experience is missing. | ADAPT | 1 |
| **Tool Routing** | System prompt instructs agent to prefer tools. Clear descriptions. | System prompt has strict rules for media tools but generic for others. | Venice needs clearer semantic differentiation between tools. | ADAPT | 2 |
| **Tool Rendering** | Expandable/collapsible boxes, spinners, diff blocks. | Linear scroll of tool events with spinners. | Kimi output is more compact for large outputs. | ADAPT | 4 |
| **Approvals** | Inline dialogs with explicit Yes/No/Always options and risk markers. | Basic Prompt in terminal. | Kimi has better interactive selection and preview. | ADAPT | 6 |
| **Status** | Persistent bottom bar with token usage, mode, working dir. | Persistent bottom bar with model, branch, tokens. | Venice is mostly on par but can improve UX density. | KEEP VENICE | 7 |
| **Models** | Interactive list via pi-tui with fuzzy search. | Ink SelectInput or custom command. | Kimi picker has more metadata. | ADAPT | 8 |
| **Sessions** | SQLite/minidb backed sessions with resumes and picker. | Basic session list and resume. | Kimi handles persistence natively across workspaces. | KEEP VENICE | 10 |
| **Context** | Sophisticated token-aware context window compaction in `packages/transcript`. | Basic ContextManager with simple token counting. | Kimi compaction is far more robust. | DEFER | - |
| **File Mentions** | `@` trigger with fuzzy filesystem matching. | `@` placeholder parser, no interactive autocomplete. | Venice lacks interactive `@file` autocomplete in TUI. | ADAPT | 9 |
| **Slash Controls** | Extensive `/` commands (settings, tools, skills) with fuzzy matching. | `/` commands map directly to actions, no fuzzy UI popup. | Venice needs a slash command popup menu. | ADAPT | 15 |
| **MCP** | Built-in MCP integration with conversational config. | MCP tools loaded via explicit config. | Venice MCP config is not as interactive. | DEFER | - |
| **Skills** | Directory-based skills with `SKILL.md`. | Directory-based skills with `SKILL.md`. | Venice skill format is almost identical. | KEEP VENICE | - |
| **Subagents** | Bounded parallel subagents. | Bounded parallel subagents. | Venice isolation model is strong. | KEEP VENICE | - |
| **Performance** | Fast startup due to esbuild/binary/pi-tui. | Fast startup (Node.js + Ink). | Kimi has edge in TUI render speed. | DEFER | 12 |
| **Errors** | Safe degradation and compact error messages instead of stack traces. | Some stack traces still leak on critical failure. | Venice needs error truncating. | ADAPT | 22 |
| **Small Terminal**| Resize handlers dynamically adjust composer width and height. | Ink handles basic resize but can overflow. | Venice TUI needs strict layout boundaries. | ADAPT | 11 |

## Decisions

### ADOPT
- None directly wholesale due to framework difference (pi-tui vs Ink).

### ADAPT
- **Composer / Multiline**: Implement Shift+Enter handling and paste parsing in Venice `Composer` using Ink (`src/ui/composer.tsx`).
- **Tool Routing**: Port system prompt tool guidance from `packages/agent-core-v2/src/app/agentProfileCatalog/system.md` to Venice's `src/agent/instructions.ts`.
- **Tool Rendering / Output Folding**: Add `<Details>`/`<Summary>` style expandable components in Ink for `src/ui/tool-event.tsx`.
- **Approvals**: Enhance `src/ui/approval.tsx` to include explicit interactive Yes/No/Always buttons using `ink-select-input`.
- **File Mentions (@)**: Add `ink-text-input` intercept for `@` to show autocomplete overlay in `src/ui/composer.tsx`.
- **Errors**: Catch and truncate raw stack traces in `src/index.ts` and `src/agent/runtime.ts` replacing them with simple `✗ [Task] failed · exit [code]`.
- **Small Terminal**: Add `useStdoutDimensions` to `src/ui/app.tsx` and dynamically cap heights.

### KEEP VENICE
- Session UX, History persistence, Status Bar, Skills, Subagents. Venice's current architecture handles these well within the Ink framework and its privacy constraints.

### DEFER
- Context window compaction, Performance optimizations, MCP conversational UI.

### REJECT
- Replacing Ink with `pi-tui`.
- Kimi authentication and telemetry flows.

## Direct Kimi Code Reuse
Files reused/adapted: None yet.
Attribution added: N/A
License review: PASS
If none: NONE — architectural patterns only.
