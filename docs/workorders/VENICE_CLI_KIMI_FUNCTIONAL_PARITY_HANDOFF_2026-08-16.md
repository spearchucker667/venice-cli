# Venice CLI — Kimi Code Functional Parity Audit & Agent Handoff
## 2026-08-16

Repository: https://github.com/spearchucker667/venice-cli
Audited branch: main
Audited commit: 8edd14675cd3512f8e4961038daa7a6c8a0fd1f2
Target comparator: current Kimi Code CLI

# Bottom line

Venice CLI is now a real agent CLI, but it is not yet functionally equivalent to current Kimi Code CLI.

Already present:
- default interactive agent
- iterative model/tool loop
- filesystem/search/git/shell tools
- Venice search/media tools
- MCP
- Skills
- subagents
- sessions + TUI resume
- model picker/capability profiling
- compaction
- todos
- checkpoints/undo/redo
- approval modes
- @file completion
- multiline composer
- slash commands
- status UI
- Venice API parity work

Highest-value remaining Kimi-style gaps:
1. real read-only Plan Mode
2. first-class Shell Mode
3. --continue / --session startup UX
4. stream-json noninteractive event output
5. /fork, /title, export/import session lifecycle
6. custom main agents + --agent-file
7. separate subagent model selection
8. --add-dir multi-root workspaces
9. --skills-dir overrides
10. ACP IDE mode
11. local server + browser UI
12. doctor diagnostics
13. upgrade command
14. hooks
15. plugins
16. themes/settings UI
17. tasks/goals
18. richer slash-command picker and aliases
19. editor integration
20. stronger event replay/session metadata

# Source of truth

Kimi behavior:
- https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html
- https://www.kimi.com/code/docs/en/kimi-code-cli/guides/interaction.html
- https://www.kimi.com/code/docs/en/kimi-code-cli/guides/sessions.html
- https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-command.html
- https://www.kimi.com/code/docs/en/kimi-code-cli/reference/slash-commands.html
- https://github.com/MoonshotAI/kimi-code

Venice API:
- https://github.com/veniceai/api-docs
- https://docs.venice.ai/swagger.yaml

# P0/P1 parity work

## KIMI-PARITY-001 — Real Plan Mode

Current Venice `/plan` only displays todo items. It does not constrain execution.

Required:
- `venice --plan`
- `/plan`, `/plan on`, `/plan off`
- optional keyboard toggle
- runtime state `operatingMode: 'agent' | 'plan'`
- only plan-safe read tools exposed
- no writes, patches, shell, mutating MCP, media generation, or write subagents
- model may request plan entry
- exit must submit plan for approval/revision

Suggested tool metadata:

```ts
interface AgentTool {
  name: string;
  planSafe: boolean;
  parallelSafe: boolean;
  // existing schema/risk/execute...
}
```

Acceptance:
- write tools absent from model schema in plan mode
- shell absent
- unsafe MCP absent
- rejected plan leaves runtime in plan mode

## KIMI-PARITY-002 — First-class Shell Mode

Current Venice has shell as an agent tool and `!command`, not Kimi-style direct shell input.

Required:
- `Ctrl-X` toggles Agent/Shell
- prompt changes `>` ↔ `$`
- status bar shows mode
- shell input executes directly without model round trip
- preserve hardened approval/security model
- explicit warning that shell runs with user OS privileges

Do not claim persistent `cd`/environment state unless a persistent PTY is actually implemented.

## KIMI-PARITY-003 — Session startup flags

Add top-level:
```bash
venice --continue
venice --session
venice --session <id>
venice -p "..."
```

Rules:
- `--continue` XOR `--session`
- bare `--session` opens picker only in TTY
- resume restores model, active skills, todos, agent identity, session context, approval mode unless explicitly overridden

## KIMI-PARITY-004 — stream-json protocol

Current `--json` emits a final summary only.

Add:
```bash
venice -p "Review repo" --output-format text
venice -p "Review repo" --output-format stream-json
```

JSONL should include:
```json
{"type":"session.started"}
{"type":"assistant.message","content":"..."}
{"type":"tool.requested","tool":"read_file","input":{}}
{"type":"tool.completed","tool":"read_file","result":{}}
{"type":"session.completed","status":"complete"}
```

stdout must be protocol only; stderr for progress/logging.
Version the schema and redact secrets.

## KIMI-PARITY-005 — Session fork/title/export/import

Add:
```text
/fork
/title
/rename
/export
/export-debug-zip
/import
```

CLI:
```bash
venice export [session-id]
venice import <file>
```

Persist:
- title
- parent session ID
- CLI/session schema version
- agent
- model
- primary + extra workspace roots

Venice should be more privacy-conservative than Kimi about bundling unrelated global logs.

## KIMI-PARITY-006 — Custom main agents

Add discovery:
```text
~/.venice/agents/
.venice/agents/
```

Example:
```markdown
---
name: reviewer
description: Read-only code reviewer
model: default
mode: read-only
tools:
  allow:
    - read_file
    - glob
    - grep
    - git_status
    - git_diff
---

You are a rigorous code reviewer...
```

CLI:
```bash
venice --agent reviewer
venice --agent-file ./reviewer.md
venice -p --agent reviewer "Review this branch"
```

Bind agent identity at session creation and persist it.

## KIMI-PARITY-007 — Subagent model selector

Add:
```text
/subagent-model
```

Config should support a Venice model ID or model trait such as `fastest`.
Validate the selected model supports required tool capabilities.

## KIMI-PARITY-008 — Multi-root workspace

Add repeatable:
```bash
venice --add-dir ../shared
venice --add-dir /path/to/docs
```

Architecture:
```ts
interface WorkspaceScope {
  primaryRoot: string;
  additionalRoots: string[];
}
```

Every file tool must resolve against one declared root. Do not bypass workspace safety globally.

## KIMI-PARITY-009 — Skills directory overrides

Add repeatable:
```bash
venice --skills-dir /team/skills
venice --skills-dir ./local-skills
```

Semantics:
- CLI dirs replace auto-discovered dirs for this launch
- persistent config may add extra dirs
- `/skills` displays origin/trust information

## KIMI-PARITY-010 — ACP IDE mode

Add:
```bash
venice acp
```

ACP must support:
- JSON-RPC stdin/stdout
- create/resume session
- streaming
- approvals
- cancellation
- tool-call states
- model selection
- resource/file refs

Do not conflate ACP with MCP.

## KIMI-PARITY-011 — Local server + browser UI

Add:
```bash
venice web
venice web --no-open
venice web --port 58627
```

Requirements:
- foreground process
- REST + WebSocket/SSE
- browser UI
- loopback-only default
- bearer auth default
- host-header/DNS-rebinding defense
- clean SIGINT/SIGTERM shutdown
- no background daemon by default

Suggested:
```text
POST /api/v1/sessions
GET  /api/v1/sessions
GET  /api/v1/sessions/:id
POST /api/v1/sessions/:id/messages
POST /api/v1/sessions/:id/cancel
WS   /api/v1/sessions/:id/events
```

## KIMI-PARITY-012 — doctor

Add:
```bash
venice doctor
venice doctor config
venice doctor api
venice doctor mcp
venice doctor models
venice doctor security
```

Check:
- config validity
- auth configured without printing secret
- default model availability/capabilities
- API reachability
- MCP config/executables
- Skills parsing
- session permissions
- shell backend
- Node version
- git
- package/update identity
- API-contract pin age

Return stable CI exit codes.

# P2 product parity

## KIMI-PARITY-013 — upgrade command

Add:
```bash
venice upgrade
venice update
```

Detect npm/pnpm/yarn/bun/native install source.

New bug found during scan:
`package.json` was renamed to `@spearchucker667/venice-cli`, but `src/index.ts` still has:

```ts
const pkg = { name: 'veniceai-cli', version: getVersion() };
```

That can make update checks target the wrong npm package. Derive package identity from one source of truth.

## KIMI-PARITY-014 — Hooks

Support trusted lifecycle hooks:
```text
session.start
session.end
prompt.submit
tool.before
tool.after
file.changed
validation.before
validation.after
compact.before
compact.after
```

Project hooks are executable code and must require trust/consent.

## KIMI-PARITY-015 — Plugins

Possible plugin structure:
```text
plugin/
  plugin.json
  skills/
  agents/
  hooks/
  mcp.json
  themes/
```

Commands:
```bash
venice plugins list
venice plugins add <path-or-package>
venice plugins remove <name>
venice plugins inspect <name>
```

Never execute arbitrary install scripts by default.

## KIMI-PARITY-016 — Settings/themes

Add:
```text
/settings
/config
/theme
/editor
```

Expose model, permission, default plan mode, theme, editor, context settings, Skills dirs, subagent model, MCP status.

## KIMI-PARITY-017 — Tasks

Venice todos are not equivalent to Kimi background tasks.

Introduce explicit task lifecycle:
```ts
interface BackgroundTask {
  id: string;
  title: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  sessionId: string;
}
```

TUI:
```text
/tasks
/task <id>
/task cancel <id>
```

Do not claim persistence after process exit unless implemented.

## KIMI-PARITY-018 — Goals

Add persistent session goal:
```text
/goal
/goal set <text>
/goal clear
```

Goal should guide planning without overriding project instructions/security.

## KIMI-PARITY-019 — Slash command picker

Replace a string array + switch as the canonical registry with:

```ts
interface SlashCommandDefinition {
  name: string;
  aliases?: string[];
  description: string;
  availability: 'always' | 'idle';
  handler: SlashHandler;
}
```

Type `/` -> fuzzy popup with descriptions/aliases.
Integrate Skill commands.
Unknown slash input should be sent to the model unless reserved.

## KIMI-PARITY-020 — Compaction hints

Support:
```text
/compact Keep database migration decisions and unresolved failures
```

API:
```ts
runtime.forceCompact(hint?: string)
```

Persist pre/post token estimate and hint.

## KIMI-PARITY-021 — External editor

Add `/editor` and shortcut such as `Ctrl-G`.

Use `$VISUAL`, `$EDITOR`, or explicit configured command.
Use a secure temp file and safe process spawning; do not interpolate into a shell string.

## KIMI-PARITY-022 — Rich input/paste

Improve:
- bracketed paste
- multiline paste
- cursor movement across lines
- Home/End
- word navigation
- delete-word
- persistent draft
- optional vi/emacs behavior

Evaluate a custom Ink editor component before replacing Ink itself.

## KIMI-PARITY-023 — Tool rendering

Add compact expandable tool UI:
- collapsible completed calls
- stdout/stderr
- diff renderer
- duration
- affected files
- validation result
- approval badge
- nested subagent activity

## KIMI-PARITY-024 — Approval UX

Show:
```text
Allow once
Allow for session
Allow matching pattern
Deny
```

Approval preview should include tool, risk, cwd/root, paths, external side effect, sanitized command.

For shell:
```text
Runs with your OS account privileges.
Not filesystem-sandboxed.
```

# Features Venice should intentionally keep different

Do NOT mechanically copy Kimi authentication/provider behavior.

Keep Venice-native:
- Venice API key
- x402 where officially supported
- Venice model traits/mappings
- privacy metadata
- E2EE/TEE
- image/video/audio/music
- Venice search
- Venice billing/key management

Only add generic multi-provider management if the product explicitly becomes a general model CLI.

Do not copy telemetry merely for parity.

# Target top-level UX

```bash
venice
venice -p "Fix the failing test"
venice --continue
venice --session
venice --session <id>
venice --plan
venice --yolo
venice --auto
venice --model <id-or-trait>
venice --agent reviewer
venice --agent-file ./agent.md
venice --skills-dir ./skills
venice --add-dir ../shared
venice --output-format stream-json -p "Review this repo"

venice acp
venice web
venice doctor
venice export
venice upgrade
```

Keep deterministic Venice commands:
```text
chat
image
video
music
tts
transcribe
models
responses
billing
keys
tee
rpc
```

# Target TUI command set

```text
/help
/auth
/logout
/model
/subagent-model
/settings
/permission
/theme
/editor

/new
/sessions
/resume
/fork
/title
/rename
/compact
/context
/export
/import

/plan
/tasks
/goal

/tools
/mcp
/skills
/agents

/status
/diff
/review
/git
/init

/version
/changelog
/quit
```

# Recommended keyboard UX

```text
Ctrl-X       toggle Agent/Shell
Shift-Tab    toggle Plan
Ctrl-C       cancel; second/idle exit
Ctrl-D       exit on empty composer
Ctrl-J       newline
Ctrl-G       external editor
Tab          accept completion
Up/Down      history/picker
Esc          dismiss/cancel UI
```

Verify terminal behavior on macOS/Linux/Windows before promising exact shortcuts.

# Architecture recommendation

Use one unified mode object:

```ts
interface RuntimeModeState {
  inputMode: 'agent' | 'shell';
  operatingMode: 'agent' | 'plan';
  permissionMode: 'suggest' | 'auto-edit' | 'auto' | 'yolo';
}
```

Use the same internal event stream for:
- TUI
- stream-json
- ACP
- web server
- session replay

This is critical to avoid four diverging front ends.

Session schema should add:
```ts
interface StoredSessionV2 {
  schemaVersion: 2;
  sessionId: string;
  parentSessionId?: string;
  title?: string;
  agentId?: string;
  workspace: {
    primaryRoot: string;
    additionalRoots: string[];
  };
  mode: RuntimeModeState;
  // state/timestamps...
}
```

# Implementation phases

Phase A — core interaction:
1. real Plan Mode
2. Shell Mode
3. startup session flags
4. stream-json
5. session fork/title
6. structured slash registry

Phase B — agent customization:
7. custom agents
8. subagent model
9. --skills-dir
10. --add-dir
11. compaction hint
12. editor

Phase C — integration:
13. ACP
14. doctor
15. export/import
16. upgrade

Phase D — richer product:
17. hooks
18. plugins
19. themes/settings
20. tasks/goals
21. web UI/server

# Acceptance matrix

Launch:
- [ ] `venice` starts TUI
- [ ] `venice -p` works
- [ ] `--continue`
- [ ] `--session`
- [ ] `--session ID`
- [ ] invalid flag combinations fail clearly
- [ ] stream-json stdout is pure JSONL

Plan:
- [ ] `--plan`
- [ ] TUI toggle
- [ ] visible plan state
- [ ] no writes
- [ ] no shell
- [ ] no unsafe MCP
- [ ] model may request entry
- [ ] exit requires plan approval

Shell:
- [ ] Ctrl-X toggle
- [ ] no model round trip
- [ ] visible shell status
- [ ] cancellation
- [ ] environment redaction
- [ ] accurate privilege warning

Sessions:
- [ ] new
- [ ] sessions/resume
- [ ] fork
- [ ] title
- [ ] compact hint
- [ ] Markdown export
- [ ] debug archive
- [ ] import
- [ ] parent session metadata

Agents:
- [ ] --agent
- [ ] --agent-file
- [ ] global/project agent dirs
- [ ] subagent model
- [ ] identity persisted

Skills/workspaces:
- [ ] repeatable --skills-dir
- [ ] persistent extra Skill dirs
- [ ] repeatable --add-dir
- [ ] path safety per allowed root

Integration:
- [ ] acp
- [ ] doctor
- [ ] upgrade
- [ ] web
- [ ] authenticated loopback server

TUI:
- [ ] fuzzy slash picker
- [ ] @file autocomplete
- [ ] multiline
- [ ] shell mode
- [ ] plan mode
- [ ] editor shortcut
- [ ] compact tool rendering
- [ ] approval scopes
- [ ] session picker
- [ ] model picker
- [ ] small terminal support

# Tests to add

```text
src/agent/plan-mode.test.ts
src/agent/runtime-modes.test.ts
src/agent/session-fork.test.ts
src/agent/custom-agents.test.ts
src/commands/agent.session-flags.test.ts
src/commands/agent.stream-json.test.ts
src/commands/doctor.test.ts
src/commands/export.test.ts
src/commands/acp.test.ts
src/commands/web.test.ts
src/ui/shell-mode.test.tsx
src/ui/plan-mode.test.tsx
src/ui/slash-picker.test.tsx
src/ui/editor.test.tsx
```

# Validation

Before edits:
```bash
git rev-parse HEAD
git status --short
npm ci
npm run verify
```

After each phase:
```bash
npm run lint
npm run build
npm run test:compiled
npm run test:security
npm run completions:check
npm run api:contract
npm run pack:check
```

# Final directive

Do not copy Kimi source code merely to obtain parity.

Match the workflow contract:
- launch agent naturally
- plan safely
- execute shell directly
- resume/fork/export sessions
- customize agents/Skills
- use MCP
- drive from IDE through ACP
- run scripts with JSONL
- diagnose installation
- optionally operate through a local web UI

Keep Venice’s differentiators stronger than Kimi where possible: Venice-native media, privacy, model metadata, E2EE/TEE, search, billing, keys, and x402.

Do not call the CLI Kimi-equivalent until the acceptance matrix above is green.
