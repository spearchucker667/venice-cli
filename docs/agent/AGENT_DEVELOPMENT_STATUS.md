# Venice Agent Development Status

## Phase 1 — Agent Runtime Foundation

Status: **Implementation complete.**

### Implemented

| Component | Files | Tests |
|-----------|-------|-------|
| Agent types and event bus | `src/agent/types.ts`, `src/agent/events.ts` | `src/agent/events.test.ts` |
| Workspace manager + Git root detection | `src/agent/workspace.ts` | `src/agent/workspace.test.ts` |
| Permission manager + risk classification | `src/agent/permissions.ts` | `src/agent/permissions.test.ts` |
| Tool registry + definitions | `src/tools/types.ts`, `src/tools/result.ts`, `src/tools/registry.ts` | `src/tools/registry.test.ts` |
| Filesystem tools | `src/tools/filesystem/*.ts` | `src/tools/filesystem/filesystem.test.ts` |
| Search tools | `src/tools/search/*.ts` | `src/tools/search/search.test.ts` |
| Shell tool | `src/tools/shell/*.ts` | `src/tools/shell/execute.test.ts` |
| Git tools | `src/tools/git/*.ts` | `src/tools/git/git.test.ts` |
| Agent meta tools | `src/tools/agent-meta/*.ts` | `src/tools/agent-meta/meta.test.ts` |
| Context manager | `src/agent/context.ts` | `src/agent/context.test.ts` |
| Session persistence | `src/agent/sessions.ts` | `src/agent/sessions.test.ts` |
| Venice model client | `src/agent/model-client.ts` | `src/agent/model-client.test.ts` |
| Agent runtime | `src/agent/runtime.ts` | `src/agent/runtime.test.ts` |
| CLI command | `src/commands/agent.ts`, `src/index.ts` | `src/commands/agent.test.ts` |

### Validation Results

- `npm run build`: **PASS**
- `npm run lint`: **FAIL** (pre-existing: `src/lib/e2ee.ts` and `src/lib/tee.ts` are UTF-16 LE and cannot be parsed by ESLint)
- `npm test`: **235 pass, 3 fail** (failures are pre-existing macOS `/private/var` vs `/var` path canonicalization issues in `src/commands/account.test.ts`)

### Security Acceptance

- ✅ Path traversal rejected (`../secret`)
- ✅ Absolute external paths rejected (`/etc/passwd`, `~/.ssh/id_ed25519`)
- ✅ Symlinks escaping workspace rejected
- ✅ Destructive shell commands blocked even in `yolo` mode
- ✅ Shell commands require approval in `suggest` and `auto-edit` modes

## Phase 2 — Instructions, Validation, Model-Aware Context

Status: **Implementation complete.**

### Implemented

| Component | Files | Tests |
|-----------|-------|-------|
| Project instruction resolver | `src/agent/instructions.ts` | `src/agent/instructions.test.ts` |
| Validation command detection | `src/agent/validation.ts` | `src/agent/validation.test.ts` |
| Validation runner tool | `src/tools/validation/run.ts` | `src/tools/validation/run.test.ts` |
| Model-aware context limits | `src/agent/model-client.ts`, `src/agent/context.ts` | `src/agent/model-client.test.ts`, `src/agent/context.test.ts` |
| Runtime integration | `src/agent/runtime.ts` | `src/agent/runtime.test.ts` |

### Validation Results

- `npm run build`: **PASS**
- `npm test`: **250 pass, 3 fail** (same pre-existing macOS path issues)

### Deferred to Later Phases

- Full interactive Terminal UI (Ink/React)
- MCP integration
- Skill system
- Checkpoints / undo
- Subagents
- Streaming UI integration
- Auto-validation after edits in runtime loop

### Next Milestone

Phase 3 — Expose existing Venice-native capabilities (search, media generation) as agent tools, and begin the interactive terminal UI foundation.

## Phase 3 — Venice-Native Tools and TUI Foundation

Status: **Implementation complete.**

### Implemented

| Component | Files | Tests |
|-----------|-------|-------|
| Venice search tools (`web_search`, `web_scrape`) | `src/tools/venice/search.ts` | `src/tools/venice/search.test.ts` |
| Venice image generation tool (`generate_image`) | `src/tools/venice/image.ts` | `src/tools/venice/image.test.ts` |
| Tool registry wiring | `src/tools/registry.ts` | `src/tools/registry.test.ts` |
| Event-driven TUI renderer foundation | `src/ui/renderer.ts` | `src/ui/renderer.test.ts` |
| CLI `--interactive` flag | `src/commands/agent.ts` | `src/commands/agent.test.ts` |

### Validation Results

- `npm run build`: **PASS**
- `npm run lint`: **FAIL** (pre-existing: `src/lib/e2ee.ts` and `src/lib/tee.ts` are UTF-16 LE and cannot be parsed by ESLint)
- `npm test`: **254 pass, 3 fail** (failures are pre-existing macOS `/private/var` vs `/var` path canonicalization issues in `src/commands/account.test.ts`)

### Compatibility Notes

- Existing `venice search` / `venice image` commands remain unchanged.
- New `web_search`, `web_scrape`, and `generate_image` agent tools reuse the existing Venice API implementations internally.
- The TUI renderer is event-driven and runtime-agnostic; no Ink/React dependency was added yet.

### Deferred to Later Phases

- Full Ink/React interactive terminal UI
- MCP integration
- Skill system
- Checkpoints / undo
- Subagents
- Streaming UI integration
- Auto-validation after edits in runtime loop
- Additional Venice-native media tools (video, audio, image editing/upscale) as agent tools

### Next Milestone

Phase 4 — MCP integration: load external MCP servers as normalized agent tools behind the same permission and registry boundaries.

## Phase 4 — MCP Integration

Status: **Implementation complete.**

### Implemented

| Component | Files | Tests |
|-----------|-------|-------|
| MCP config loader (`~/.venice/mcp.json` + workspace `.venice/mcp.json`) | `src/mcp/config.ts` | `src/mcp/config.test.ts` |
| Stdio JSON-RPC MCP client | `src/mcp/client.ts` | `src/mcp/client.test.ts` |
| MCP manager (server lifecycle + tool discovery) | `src/mcp/manager.ts` | `src/mcp/manager.test.ts` |
| MCP tool adapter (namespaced `AgentTool`) | `src/mcp/adapter.ts` | `src/mcp/adapter.test.ts` |
| Runtime MCP wiring + failure isolation | `src/agent/runtime.ts`, `src/agent/events.ts` | `src/agent/runtime.test.ts` |
| `venice mcp list/add/remove/enable/disable/inspect` | `src/commands/mcp.ts` | `src/commands/mcp.test.ts` |
| Agent command loads MCP config and injects manager | `src/commands/agent.ts` | `src/commands/agent.test.ts` |
| Command registration | `src/index.ts` | existing CLI tests |

### Validation Results

- `npm run build`: **PASS**
- `npm run lint`: **FAIL** (pre-existing: `src/lib/e2ee.ts` and `src/lib/tee.ts` are UTF-16 LE and cannot be parsed by ESLint)
- `npm test`: **274 pass, 3 fail** (failures are pre-existing macOS `/private/var` vs `/var` path canonicalization issues in `src/commands/account.test.ts`)

### Security Notes

- MCP tools are namespaced as `mcp:<server>:<tool>` to avoid registry collisions.
- MCP tools default to `execute` risk and require approval in `suggest` and `auto-edit` modes.
- Server startup failures are isolated: the runtime emits `mcp_failed` and continues without MCP tools.
- `venice mcp inspect` masks environment variable values.

### Deferred to Later Phases

- Full interactive Terminal UI (Ink/React)
- Skill system
- Checkpoints / undo
- Subagents
- Streaming UI integration
- Auto-validation after edits in runtime loop
- Additional Venice-native media tools (video, audio, image editing/upscale) as agent tools

### Next Milestone

Phase 5 — Choose one of: checkpoints/undo, skill system, or full terminal UI. Default recommendation: checkpoints/undo because it hardens the agent's ability to safely reverse edits before building higher-level features.

## Phase 5 — Checkpoints / Undo

Status: **Implementation complete.**

### Implemented

| Component | Files | Tests |
|-----------|-------|-------|
| Checkpoint manager | `src/agent/checkpoints.ts` | `src/agent/checkpoints.test.ts` |
| ToolContext wiring | `src/tools/types.ts`, `src/agent/runtime.ts`, `src/agent/sessions.ts` | `src/agent/runtime.test.ts` |
| Write/edit/patch checkpoint recording | `src/tools/filesystem/write.ts`, `edit.ts`, `patch.ts` | `src/tools/filesystem/filesystem.test.ts` |
| Checkpoint meta tools | `src/tools/agent-meta/checkpoint-list.ts`, `checkpoint-undo.ts`, `checkpoint-redo.ts` | `src/tools/agent-meta/checkpoint-meta.test.ts` |
| Runtime/context state | `src/agent/types.ts`, `src/agent/context.ts` | `src/agent/context.test.ts`, `src/agent/runtime.test.ts` |

### Validation Results

- `npm run build`: **PASS**
- `npm run lint`: **FAIL** (pre-existing UTF-16 binary files)
- `npm test`: **286 pass, 3 fail** (pre-existing macOS path issues)

### Security Notes

- Checkpoints store full file snapshots in the session directory (`~/.venice/sessions/<id>/checkpoints/`).
- Checkpoints do not escape the workspace: paths are resolved relative to the workspace root.
- Undo of a newly-created file deletes it; redo recreates it.
- Checkpoint history persists across session resume via `history.json`.

### Deferred to Later Phases

- Full interactive Terminal UI (Ink/React)
- Skill system
- Subagents
- Streaming UI integration
- Auto-validation after edits in runtime loop
- Additional Venice-native media tools (video, audio, image editing/upscale) as agent tools

### Next Milestone

Phase 6 — Skill system: progressive skill discovery and loading.

## Phase 6 — Skill System

Status: **Implementation complete.**

### Implemented

| Component | Files | Tests |
|-----------|-------|-------|
| Skill frontmatter parser | `src/skills/parser.ts`, `src/skills/types.ts` | `src/skills/parser.test.ts` |
| Skill discovery registry | `src/skills/registry.ts` | `src/skills/registry.test.ts` |
| Skill meta tools | `src/tools/agent-meta/skill-list.ts`, `src/tools/agent-meta/skill-load.ts` | `src/tools/agent-meta/skill-meta.test.ts` |
| Runtime/context integration | `src/agent/runtime.ts`, `src/agent/context.ts`, `src/agent/types.ts`, `src/agent/permissions.ts` | `src/agent/runtime.test.ts`, `src/agent/context.test.ts` |
| `venice skills` CLI | `src/commands/skills.ts` | `src/commands/skills.test.ts` |

### Validation Results

- `npm run build`: **PASS**
- `npm run lint`: **FAIL** (pre-existing: `src/lib/e2ee.ts` and `src/lib/tee.ts` are UTF-16 LE and cannot be parsed by ESLint)
- `npm test`: **302 pass, 3 fail** (failures are pre-existing macOS `/private/var` vs `/var` path canonicalization issues in `src/commands/account.test.ts`)

### Design Notes

- No new runtime dependencies were added; frontmatter is parsed with a small hand-coded reader.
- Skills are progressively disclosed: only metadata appears in working memory by default. The full `SKILL.md` body is injected into the system context only after the model calls `skill_load`.
- Global skills are discovered from `~/.config/venice/skills/` and project skills from `<workspace>/.venice/skills/`. Project skills override global skills with the same name.
- `skill_list` and `skill_load` are classified as read-risk tools so they can be auto-approved in appropriate modes while still requiring approval in `suggest` mode.

### Deferred to Later Phases

- Full interactive Terminal UI (Ink/React)
- Subagents
- Streaming UI integration
- Auto-validation after edits in runtime loop
- Additional Venice-native media tools (video, audio, image editing/upscale) as agent tools

### Next Milestone

Phase 7 — Full interactive terminal UI (Ink/React), or continue with auto-validation after edits. Recommendation: terminal UI, since it is the remaining large user-facing piece before the agent feels like a polished CLI.

## Phase 7 — Full Interactive Terminal UI

Status: **Implementation complete.**

### Implemented

| Component | Files | Tests |
|-----------|-------|-------|
| Ink/React dependency setup + JSX config | `package.json`, `tsconfig.json` | build validation |
| TUI state types | `src/ui/types.ts` | — |
| Slash command parser | `src/ui/slash-commands.ts` | `src/ui/slash-commands.test.ts` |
| File mention resolver | `src/ui/mentions.ts` | `src/ui/mentions.test.ts` |
| Slash command handlers | `src/ui/slash-handlers.ts` | `src/ui/slash-handlers.test.ts` |
| Runtime event mapper | `src/ui/events.ts` | `src/ui/events.test.ts` |
| Composer component | `src/ui/composer.tsx` | `src/ui/composer.test.tsx` |
| Approval prompt component | `src/ui/approval.tsx` | `src/ui/approval.test.tsx` |
| Tool-call event component | `src/ui/tool-call.tsx` | `src/ui/tool-call.test.tsx` |
| Transcript component | `src/ui/transcript.tsx` | `src/ui/transcript.test.tsx` |
| Status bar component | `src/ui/status.tsx` | `src/ui/status.test.tsx` |
| App/runtime wiring | `src/ui/app.tsx`, `src/ui/tui.tsx` | `src/ui/app.test.tsx` |
| CLI integration | `src/commands/agent.ts` | `src/commands/agent.test.ts` |
| Runtime approval callback | `src/agent/runtime.ts` | `src/agent/runtime.test.ts` |

### Validation Results

- `npm run build`: **PASS**
- `npm run lint`: **FAIL** (pre-existing: `src/lib/e2ee.ts` and `src/lib/tee.ts` are UTF-16 LE and cannot be parsed by ESLint)
- `npm test`: **330 pass, 3 fail** (failures are pre-existing macOS `/private/var` vs `/var` path canonicalization issues in `src/commands/account.test.ts`)

### Design Notes

- The TUI is a thin React/Ink layer over the existing `AgentRuntime`; no business logic moved into components.
- `venice agent` launches the TUI automatically in an interactive TTY unless `--no-interactive`, `--json`, or stdin is piped.
- Approval prompts are rendered inline and block the runtime until the user chooses Yes/Session/No.
- Slash commands (`/help`, `/quit`, `/clear`, `/status`, etc.) are handled without sending text to the model.
- `@file` mentions are resolved to workspace-relative paths and surfaced in the transcript.
- `!command` shell passthrough runs through the existing controlled `shellTool` after approval.
- First Ctrl+C aborts the active runtime; second Ctrl+C exits the app.

### Deferred to Later Phases

- Full follow-up chat within a single runtime session (current TUI starts one runtime per submitted objective).
- Model picker UI (`/model` currently reports not implemented).
- Session resume UI (`/resume` currently reports not implemented).
- Inline diff/code review panes.
- Image/media previews.
- Subagents.

### Next Milestone

Phase 8 — Auto-validation after edits in the runtime loop, or begin read-only subagents. Recommendation: auto-validation, because it hardens the agent's ability to verify its own work before adding higher-level orchestration.

## Phase 8 — Auto-Validation After Edits

Status: **Implementation complete.**

### Implemented

| Component | Files | Tests |
|-----------|-------|-------|
| Auto-validation state + config | `src/agent/types.ts`, `src/agent/runtime.ts` | `src/agent/runtime.test.ts` |
| Per-turn edit detection | `src/agent/runtime.ts` | `src/agent/runtime.test.ts` |
| Validation runner + events | `src/agent/runtime.ts`, `src/agent/events.ts` | `src/agent/runtime.test.ts` |
| Context/final-message wiring | `src/agent/context.ts`, `src/agent/runtime.ts` | `src/agent/context.test.ts`, `src/agent/runtime.test.ts` |
| Permission policy for `run_validation` | `src/agent/permissions.ts` | `src/agent/permissions.test.ts` |
| Fixed read tools polluting `changedFiles` | `src/tools/filesystem/read.ts`, `read-many.ts`, `list.ts` | `src/agent/runtime.test.ts` |

### Validation Results

- `npm run build`: **PASS**
- `npm run lint`: **FAIL** (pre-existing: `src/lib/e2ee.ts` and `src/lib/tee.ts` are UTF-16 LE and cannot be parsed by ESLint)
- `npm test`: **336 pass, 3 fail** (failures are pre-existing macOS `/private/var` vs `/var` path canonicalization issues in `src/commands/account.test.ts`)

### Design Notes

- `autoValidate` defaults to `true` in `AgentRuntimeOptions` and can be disabled per session.
- Validation runs once per assistant turn if any tool in that turn produced `affectedFiles`.
- Only genuinely mutating tools (`write_file`, `edit_file`, `apply_patch`, `generate_image`) now populate `affectedFiles`; read tools no longer pollute `changedFiles`.
- `run_validation` is auto-approved in `auto-edit` mode (a direct consequence of edits) but still requires approval in `suggest` mode.
- `validation_started` and `validation_completed` events are emitted for each command.
- Results are stored in `AgentState.lastValidation`, surfaced in working memory, and appended to the final response.
- Full command output is truncated in events/state; the complete output remains available in the shell tool result inside `toolHistory`.

### Deferred to Later Phases

- Full follow-up chat within a single runtime session.
- Model picker UI.
- Session resume UI.
- Inline diff/code review panes.
- Image/media previews.
- Subagents.
- Additional Venice-native media tools (video, audio, image editing/upscale) as agent tools.

### Next Milestone

Phase 9 — Read-only subagents, or additional Venice-native media tools. Recommendation: read-only subagents, because they extend the agent's ability to delegate exploration/research safely before enabling write-capable subagents.

## Phase 9 — Read-Only Subagents

Status: **Implementation complete.**

### Implemented

| Component | Files | Tests |
|-----------|-------|-------|
| Subagent contracts and parsing helpers | `src/agent/subagents.ts`, `src/agent/types.ts` | `src/agent/subagents.test.ts` |
| `spawn_agent` tool with bounded read-only runtime | `src/tools/agent-meta/spawn-agent.ts` | `src/tools/agent-meta/spawn-agent.test.ts` |
| Tool registry wiring | `src/tools/registry.ts` | `src/tools/registry.test.ts` |
| Runtime report/state integration | `src/agent/runtime.ts`, `src/agent/context.ts`, `src/agent/events.ts` | `src/agent/runtime.test.ts`, `src/ui/events.test.ts` |

### Validation Results

- `npm run build`: **PASS**
- `npm run lint`: **FAIL** (pre-existing: `src/lib/e2ee.ts` and `src/lib/tee.ts` are UTF-16 LE and cannot be parsed by ESLint)
- `npm test`: **336 pass, 3 fail** (failures are pre-existing macOS `/private/var` vs `/var` path canonicalization issues in `src/commands/account.test.ts`)

### Design Notes

- Subagents are read-only by construction: the `spawn_agent` runtime is created with a restricted registry (`read_file`, `read_many_files`, `list_directory`, `glob`, `grep`, `find`, `git_status`, `git_diff`, `git_log`) and cannot execute write tools.
- Every subagent run gets an isolated session id and independent runtime/context budget.
- Subagent output is normalized into a structured report (`summary`, `findings`, `recommendations`, `filesInspected`) before returning to the parent agent.
- The parent runtime records subagent reports in state and surfaces them in working memory.
- The runtime emits `subagent_started` and `subagent_completed` events for TUI/renderer visibility.

### Deferred to Later Phases

- Write-capable subagents (explicitly out of scope for this milestone)
- Additional Venice-native media tools (video, audio, image editing/upscale) as agent tools
- Full follow-up chat within a single TUI runtime session
- Model picker / session resume UIs

### Next Milestone

Phase 10 — Additional Venice-native media tools (`edit_image`, `upscale_image`, `remove_background`, `generate_video`, `image_to_video`, `transcribe_audio`, `text_to_speech`) exposed through the same tool registry and permission system.
