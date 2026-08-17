# VENICE CLI — FULL AGENT RUNTIME DEVELOPMENT HANDOFF

## Mission

Transform the existing Venice CLI repository into a production-grade, workspace-aware AI agent CLI comparable in capability and usability to modern agentic development CLIs such as Codex CLI, Gemini CLI, Kimi CLI, Copilot CLI, Claude Code-style agents, and similar terminal-native coding assistants.

Repository:

`https://github.com/veniceai/venice-cli`

The existing Venice CLI must remain the foundation. Do **not** discard, rewrite, or bypass its working Venice API functionality merely to make agent development easier.

The objective is to evolve Venice CLI from a capable Venice API/chat command-line client into a complete agent runtime capable of:

- understanding a repository or local workspace;
- reading and searching files;
- making controlled file edits;
- executing shell commands;
- using Git;
- iteratively calling tools;
- validating its own work;
- maintaining persistent sessions;
- compacting long contexts safely;
- respecting workspace and permission boundaries;
- discovering project instructions;
- loading skills;
- using MCP servers;
- supporting planning and todos;
- eventually spawning restricted subagents;
- exposing Venice-specific capabilities such as search, media generation, E2EE, TEE, and privacy-aware model selection as native agent tools;
- providing a polished interactive terminal interface;
- preserving existing deterministic `venice` commands and API functionality.

This is a substantial architectural evolution. Treat it as production infrastructure, not a prototype.

---

## 1. Core Product Direction

The target product should conceptually become:

```text
Venice CLI
├── Venice Agent
├── Venice Chat
├── Venice Media
├── Venice Search
├── Venice Models
├── Venice API Utilities
├── MCP Runtime
└── Skill Runtime
```

Existing commands must continue to work.

Examples:

```bash
venice chat
venice image
venice video
venice models
venice search
```

The new interactive agent should be accessible through:

```bash
venice
```

and explicitly through:

```bash
venice agent
```

Non-interactive agent execution should also be supported:

```bash
venice agent -p "Review this repository and fix all TypeScript errors."
```

Do not prematurely remove or rename stable existing user-facing commands.

---

## 2. Architectural Principle

The single most important architectural rule is:

> `chat.ts` must not become the agent runtime.

Do not expand an existing chat command into a giant orchestration file.

The final architecture must separate:

- Venice transport/API access;
- model selection;
- agent orchestration;
- context management;
- tools;
- permissions;
- workspace handling;
- sessions;
- instructions;
- MCP;
- skills;
- UI;
- Git;
- validation;
- checkpoints;
- subagents.

Every major subsystem should be independently testable.

---

## 3. Required First Action: Repository Reconnaissance

Before making architectural changes:

1. Clone or update the repository.
2. Determine the current branch and working-tree state.
3. Record the current commit SHA.
4. Inspect the complete repository tree.
5. Inspect `package.json`.
6. Inspect all files under `src/`.
7. Identify:
   - CLI entry point;
   - Commander setup;
   - command registration;
   - `chat` implementation;
   - Venice API client abstraction;
   - model discovery logic;
   - tool/function-call logic;
   - config storage;
   - conversation persistence;
   - streaming implementation;
   - E2EE implementation;
   - TEE implementation;
   - media commands;
   - search/scrape commands;
   - error normalization;
   - existing test infrastructure.
8. Run all currently documented validation commands before modifying anything.
9. Record baseline pass/fail state.
10. Do not attribute pre-existing failures to the new work.

Produce a baseline report before major implementation begins.

---

## 4. Sources of Truth

Do not guess Venice API behavior.

Use this hierarchy:

1. Official Venice CLI repository implementation.
2. Official Venice API documentation.
3. Official Venice API/OpenAPI repository.
4. Existing tests.
5. Existing documented CLI behavior.
6. Only then make implementation inferences.

Official references include:

```text
https://github.com/veniceai/venice-cli
https://github.com/veniceai/api-docs
https://docs.venice.ai
```

Do not hard-code assumed model capabilities when the Venice models API exposes them dynamically.

---

## 5. Baseline Architecture Goal

Evolve the CLI toward this conceptual architecture:

```text
User
  │
  ▼
Interactive CLI / Noninteractive CLI
  │
  ▼
Agent Runtime
  │
  ├── Agent Loop
  ├── Model Client
  ├── Context Manager
  ├── Planner / Todo State
  ├── Tool Registry
  ├── Permission Manager
  ├── Workspace Manager
  ├── Session Manager
  ├── Instruction Resolver
  ├── MCP Manager
  ├── Skill Registry
  ├── Git Integration
  ├── Checkpoint Manager
  └── Event Bus
        │
        ├── Venice Chat API
        ├── Venice Search
        ├── Venice Media APIs
        ├── Filesystem
        ├── Shell
        ├── Git
        ├── MCP
        └── Future Subagents
```

---

## 6. Proposed Source Layout

Adapt this structure as necessary after inspecting the real codebase:

```text
src/
├── agent/
│   ├── runtime.ts
│   ├── loop.ts
│   ├── events.ts
│   ├── state.ts
│   ├── planner.ts
│   ├── context.ts
│   ├── compaction.ts
│   ├── permissions.ts
│   ├── approvals.ts
│   ├── sessions.ts
│   ├── workspace.ts
│   ├── instructions.ts
│   ├── checkpoints.ts
│   ├── validation.ts
│   └── subagents.ts
│
├── tools/
│   ├── registry.ts
│   ├── types.ts
│   ├── result.ts
│   ├── filesystem/
│   │   ├── read.ts
│   │   ├── read-many.ts
│   │   ├── write.ts
│   │   ├── edit.ts
│   │   ├── patch.ts
│   │   ├── list.ts
│   │   └── glob.ts
│   ├── search/
│   │   ├── grep.ts
│   │   └── find.ts
│   ├── shell/
│   │   └── execute.ts
│   ├── git/
│   │   ├── status.ts
│   │   ├── diff.ts
│   │   └── log.ts
│   ├── web/
│   └── venice/
│
├── mcp/
│   ├── client.ts
│   ├── manager.ts
│   ├── config.ts
│   └── adapters.ts
│
├── skills/
│   ├── loader.ts
│   ├── parser.ts
│   ├── registry.ts
│   └── discovery.ts
│
├── ui/
│   ├── app.tsx
│   ├── composer.tsx
│   ├── transcript.tsx
│   ├── tool-call.tsx
│   ├── approval.tsx
│   ├── status.tsx
│   ├── model-picker.tsx
│   ├── todos.tsx
│   └── session-picker.tsx
│
├── commands/
│   ├── agent.ts
│   └── existing commands...
│
└── lib/
    └── reusable Venice API/config/transport code
```

Do not force this exact tree if the current repository architecture suggests a cleaner equivalent.

---

## 7. Agent Runtime

Implement a true iterative agent loop.

The runtime must support:

```text
observe
  ↓
reason/model request
  ↓
tool request
  ↓
authorization
  ↓
tool execution
  ↓
tool result
  ↓
context update
  ↓
next model request
  ↓
...
  ↓
verification
  ↓
final response
```

The runtime must support multiple tool calls over multiple reasoning turns until one of the following occurs:

- the task is completed;
- the agent explicitly reports a blocker;
- the user cancels;
- an execution limit is reached;
- model or API failure makes continuation impossible.

Do not arbitrarily stop after one function-call round.

---

## 8. Agent Runtime State

Create explicit runtime state instead of relying on loose message arrays.

Suggested shape:

```ts
interface AgentState {
  sessionId: string;
  workspaceRoot: string;

  model: string;

  objective: string;

  status:
    | 'idle'
    | 'thinking'
    | 'awaiting_approval'
    | 'executing_tool'
    | 'verifying'
    | 'complete'
    | 'failed'
    | 'cancelled';

  messages: AgentMessage[];

  todos: TodoItem[];

  relevantFiles: string[];

  changedFiles: string[];

  toolHistory: ToolInvocation[];

  tokenUsage?: TokenUsage;

  contextSummary?: StructuredSummary;
}
```

The exact structure may change, but state must be explicit, serializable, and testable.

---

## 9. Tool Abstraction

Create one common interface for all tools.

Suggested design:

```ts
interface AgentTool<TInput = unknown, TOutput = unknown> {
  name: string;

  description: string;

  inputSchema: unknown;

  risk:
    | 'read'
    | 'write'
    | 'execute'
    | 'network'
    | 'destructive';

  execute(
    input: TInput,
    context: ToolContext
  ): Promise<ToolResult<TOutput>>;
}
```

Tools must not directly manipulate UI state.

They should emit structured results and events.

Normalize tool output:

```ts
interface ToolResult<T = unknown> {
  ok: boolean;

  data?: T;

  error?: {
    code: string;
    message: string;
    details?: unknown;
  };

  metadata?: {
    durationMs?: number;
    truncated?: boolean;
    affectedFiles?: string[];
  };
}
```

---

## 10. Minimum Built-In Tool Set

The initial coding agent must support at least:

```text
read_file
read_many_files
write_file
edit_file
apply_patch
list_directory
glob
grep
find
shell
git_status
git_diff
git_log
todo_read
todo_write
ask_user
```

Venice-specific tools should later include:

```text
web_search
web_scrape
generate_image
edit_image
upscale_image
remove_background
generate_video
image_to_video
transcribe_audio
text_to_speech
```

Only expose tools that are genuinely supported by the official Venice API.

---

## 11. Filesystem Safety

All filesystem tools must be workspace-aware.

The normal trust boundary is:

```text
workspace root
```

The agent must not silently gain unrestricted `$HOME` or system filesystem access.

Requirements:

- normalize paths;
- resolve symlinks;
- reject path traversal;
- identify paths outside workspace;
- require explicit permission before accessing external paths;
- distinguish reads from writes;
- handle binary files safely;
- enforce practical file-size limits;
- avoid dumping huge files directly into model context.

Tests must cover:

```text
../ traversal
absolute external paths
symlinks escaping workspace
broken symlinks
nonexistent files
directories passed as files
binary files
UTF-8 edge cases
large files
permission errors
```

---

## 12. File Editing Model

Support both targeted edits and patches.

At minimum:

```text
write_file
edit_file
apply_patch
```

The editing layer must:

- detect stale source content where possible;
- avoid silently overwriting concurrent changes;
- return clear failure information;
- preserve newline style where practical;
- preserve encoding;
- expose affected file paths;
- feed changes into checkpoint/session state;
- support undo infrastructure later.

Avoid model-generated full-file replacement when a precise patch is safer.

---

## 13. Shell Execution

Implement a controlled shell tool.

Suggested input:

```ts
interface ShellInput {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}
```

Output should include:

```ts
interface ShellOutput {
  command: string;
  cwd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}
```

Requirements:

- default execution directory is workspace root;
- support explicit working directory inside workspace;
- capture stdout and stderr separately;
- preserve exit code;
- enforce configurable timeout;
- support cancellation;
- truncate excessive output while retaining artifact/log references where appropriate;
- do not claim a command succeeded unless exit status supports that conclusion.

The agent must never fabricate shell output.

---

## 14. Permission System

Permissions must be a first-class subsystem.

Suggested risk categories:

```text
READ
WRITE
EXECUTE
NETWORK
OUTSIDE_WORKSPACE
DESTRUCTIVE
```

Suggested modes:

```text
suggest
auto-edit
auto
yolo
```

Behavior:

### `suggest`

Require approval for writes, shell commands, network escalation, external filesystem access, and destructive operations.

### `auto-edit`

Allow workspace file edits automatically.

Require approval for shell execution and higher-risk operations.

### `auto`

Allow normal workspace read/write and standard development commands.

Require approval for destructive or external operations.

### `yolo`

Allow broad autonomous workspace execution.

However:

`yolo` must **not** mean:

- disable path-safety logic;
- leak secrets;
- ignore system protections;
- silently escape the workspace;
- suppress command errors.

Do not confuse automation with removal of all security boundaries.

---

## 15. Approval UX

Approvals should show exactly what will happen.

Example:

```text
Run command?

$ npm test

cwd: /Users/example/project

[Yes] [Always allow this pattern] [No]
```

For edits:

```text
Modify src/app.ts?

+ import ...
- old code

[Yes] [Allow edits this session] [No]
```

Persist only explicitly requested approval scopes.

Do not accidentally convert a single approval into permanent authorization.

---

## 16. Workspace Discovery

At startup:

1. obtain `cwd`;
2. identify Git root if present;
3. identify package/toolchain files;
4. identify project instructions;
5. collect Git state;
6. detect relevant build/test/lint commands;
7. initialize workspace metadata.

Useful project indicators include:

```text
package.json
pnpm-lock.yaml
package-lock.json
yarn.lock
bun.lock
Cargo.toml
go.mod
pyproject.toml
requirements.txt
Gemfile
build.gradle
build.gradle.kts
settings.gradle.kts
pom.xml
Package.swift
*.xcodeproj
*.xcworkspace
```

Detection must not imply execution.

---

## 17. Project Instructions

Support hierarchical instructions.

At minimum:

```text
AGENTS.md
VENICE.md
.venice/instructions.md
.venice/rules/*.md
```

Recommended precedence:

```text
built-in agent contract
        ↓
global user instructions
        ↓
repository instructions
        ↓
nested path instructions
        ↓
current user request
```

Suggested global location:

```text
~/.config/venice/AGENTS.md
```

Do not blindly merge contradictory rules.

Build a deterministic precedence resolver.

Nested instructions should apply only to files within their intended subtree when applicable.

---

## 18. `venice init`

Add:

```bash
venice init
```

Suggested generated structure:

```text
.venice/
├── config.json
├── instructions.md
├── mcp.json
└── skills/
```

Do not overwrite existing files without approval.

Example `.venice/config.json`:

```json
{
  "agent": {
    "approvalMode": "suggest"
  },
  "context": {
    "autoCompact": true
  }
}
```

Keep the initial schema small and versionable.

---

## 19. Context Management

Do not continuously append unlimited chat messages and tool output.

Use explicit context layers:

```text
SYSTEM
Agent behavior contract

PROJECT
Repository instructions and metadata

WORKING MEMORY
Current objective
Todo state
Decisions
Known failures
Relevant files

CONVERSATION
Recent user/assistant messages

FILE CONTEXT
Only currently relevant file content

TOOL RESULTS
Recent/high-value results

SUMMARY
Structured compacted history
```

The context manager must know:

- model context limit;
- current estimated token usage;
- reserved completion budget;
- threshold for compaction;
- which information must never be discarded.

---

## 20. Context Compaction

Implement structured compaction.

Suggested summary schema:

```ts
interface StructuredSummary {
  objective: string;

  completedWork: string[];

  remainingWork: string[];

  decisions: string[];

  discoveries: string[];

  filesRead: string[];

  filesChanged: string[];

  commandsRun: {
    command: string;
    result: string;
  }[];

  failures: string[];

  importantConstraints: string[];
}
```

Never treat a summary of source code as equivalent to source code.

When source correctness matters, reread the actual file.

Do not compact away:

- user requirements;
- unresolved errors;
- permission decisions;
- changed-file tracking;
- current todo state;
- validation failures.

---

## 21. Dynamic Model Awareness

Use the live Venice model catalog when practical.

Do not maintain a manually hard-coded list as the primary source of truth.

Track capabilities such as:

- context size;
- tool/function support;
- reasoning support;
- structured output;
- multimodality;
- privacy-related metadata exposed by Venice;
- E2EE compatibility;
- TEE compatibility.

Agent behavior should adapt when the chosen model lacks required functionality.

Never silently pretend unsupported functionality exists.

---

## 22. Session Persistence

Implement durable agent sessions.

Commands:

```bash
venice sessions
venice resume
venice resume <session-id>
venice sessions delete <session-id>
venice sessions export <session-id>
```

Suggested storage:

```text
~/.local/share/venice/
└── sessions/
    └── <uuid>/
        ├── session.json
        ├── messages.jsonl
        ├── events.jsonl
        ├── summary.json
        └── checkpoints/
```

On macOS, respect existing platform/config conventions if the repository already uses a different storage root.

Do not duplicate conflicting storage systems unnecessarily.

---

## 23. Event Log

Use an append-oriented event model.

Examples:

```json
{"type":"session_started"}
{"type":"user_message"}
{"type":"model_request"}
{"type":"assistant_delta"}
{"type":"tool_requested"}
{"type":"approval_requested"}
{"type":"approval_granted"}
{"type":"tool_started"}
{"type":"tool_completed"}
{"type":"file_changed"}
{"type":"validation_started"}
{"type":"validation_completed"}
{"type":"context_compacted"}
{"type":"session_completed"}
```

Events should be timestamped.

This enables:

- resumption;
- debugging;
- auditability;
- replay;
- UI rendering;
- local diagnostics.

Do not require telemetry or remote collection for this feature.

---

## 24. Privacy

Venice's privacy positioning should be visible in the agent product.

Do not add hidden analytics as part of this work.

If diagnostics are introduced, they should default to local storage unless current project policy explicitly says otherwise.

Avoid storing:

- API keys;
- raw credentials;
- sensitive environment variables;

inside session transcripts.

Redact secrets before persistence where feasible.

---

## 25. Secret Handling

The agent must avoid accidentally exposing secrets.

At minimum inspect for:

```text
.env
.env.*
API keys
Authorization headers
private keys
tokens
cloud credentials
SSH keys
```

Do not inject full environment dumps into model context.

When shell commands produce secrets in output, attempt to redact obvious credential formats before persistence.

Do not break legitimate development workflows by over-redacting arbitrary strings.

---

## 26. Git Integration

Implement Git as structured agent tooling.

Required tools:

```text
git_status
git_diff
git_log
```

The agent must inspect Git state before broad modifications.

Before final completion after file edits, inspect:

```bash
git diff
```

or equivalent structured diff output.

Never claim only intended files changed without verifying.

Do not automatically:

- commit;
- push;
- reset;
- clean;
- checkout;
- force push;

unless explicitly requested or permitted by established workflow.

---

## 27. Validation Loop

Coding tasks must use evidence-driven validation.

Expected general flow:

```text
inspect
  ↓
plan
  ↓
edit
  ↓
targeted validation
  ↓
broader validation
  ↓
inspect diff
  ↓
repair failures
  ↓
final report
```

Depending on project type, validation may include:

```text
typecheck
lint
unit tests
integration tests
build
format check
security scan
package validation
```

Do not run irrelevant expensive commands merely to create activity.

Determine validation commands from repository evidence.

---

## 28. Todo / Planning System

Implement structured todos.

Suggested schema:

```ts
interface TodoItem {
  id: string;
  content: string;
  status:
    | 'pending'
    | 'in_progress'
    | 'completed'
    | 'blocked';
}
```

Tools:

```text
todo_read
todo_write
```

UI example:

```text
Tasks

✓ Inspect repository
● Build tool registry
○ Implement workspace filesystem tools
○ Add permission engine
○ Run validation
```

Do not force verbose planning for trivial actions.

Planning exists to maintain execution state, not to create performative text.

---

## 29. Slash Commands

The interactive agent should support a command system.

Target commands:

```text
/help
/model
/models
/status
/context
/compact
/clear
/new
/resume
/sessions
/tools
/mcp
/skills
/permissions
/plan
/diff
/review
/git
/init
/quit
```

Commands should be discoverable through `/help`.

Avoid undocumented magic commands.

---

## 30. File Mentions

Support explicit file context syntax such as:

```text
@src/app.ts
@package.json
@src/
```

The interface should resolve references relative to workspace.

Directory references should not blindly load all contents into context.

Instead:

- inspect directory structure;
- select relevant files;
- respect ignore rules;
- enforce context budget.

---

## 31. Shell Passthrough

Consider supporting:

```text
!git status
!npm test
```

This should invoke the same controlled shell executor.

Do not create a second unsandboxed shell execution path.

---

## 32. Ignore Rules

Workspace discovery and search should respect common ignore rules where appropriate:

```text
.gitignore
.veniceignore
```

Also avoid automatically indexing high-cost directories such as:

```text
.git
node_modules
dist
build
target
.next
coverage
vendor
```

unless specifically requested.

Do not assume ignored files can never be intentionally referenced.

Explicit user references may override discovery exclusion.

---

## 33. MCP Integration

MCP must become a first-class tool source.

Commands:

```bash
venice mcp list
venice mcp add
venice mcp remove
venice mcp enable
venice mcp disable
venice mcp inspect
```

Suggested configuration:

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-memory"
      ]
    }
  }
}
```

Support at least local stdio MCP transport first if that keeps scope controlled.

Do not implement an incomplete fake MCP abstraction merely to claim MCP support.

---

## 34. MCP Tool Normalization

MCP tools must flow through the same internal registry as built-in tools.

Conceptually:

```text
Tool Registry
├── Built-in tools
├── Venice tools
├── MCP tools
├── Skills
└── Future plugins
```

The model should receive consistent tool representations regardless of origin.

Permission policies must also apply to MCP tools.

Do not assume third-party MCP tools are inherently safe.

---

## 35. Skill System

Add an extensible skill mechanism.

Suggested locations:

```text
~/.config/venice/skills/
.venice/skills/
```

Suggested structure:

```text
skill-name/
├── SKILL.md
├── scripts/
├── references/
└── assets/
```

Suggested frontmatter:

```yaml
---
name: github-release
description: Prepare and validate repository releases.
tools:
  - shell
  - read_file
  - edit_file
---
```

The exact schema should be versionable.

---

## 36. Progressive Skill Loading

Do not inject every skill's full instructions into every conversation.

Use progressive disclosure.

Initial context should include:

```text
name
description
location
```

Load full `SKILL.md` only when:

- the agent selects the skill;
- the user explicitly invokes it;
- task routing strongly matches it.

This protects context budget.

---

## 37. Interactive Terminal UI

Once the underlying runtime is stable, implement a proper terminal interface.

Since the project is TypeScript/Node, evaluate Ink before choosing another framework.

Potential dependencies:

```text
ink
react
ink-text-input
ink-select-input
```

Do not add UI dependencies until runtime boundaries are clean.

A broken agent loop with a polished TUI is not acceptable.

---

## 38. Target Terminal Experience

Conceptual example:

```text
╭──────────────────────────────────────────────────────────────╮
│ Venice Agent                                                 │
│ kimi-k2.5 · ~/Projects/example · main                        │
╰──────────────────────────────────────────────────────────────╯

> Fix the failing build and verify the repository.

● Inspecting workspace

  Read package.json
  Read tsconfig.json
  Read src/...

● Found an unresolved import.

● Edit src/client.ts

  + import ...

  Allow this edit?

  ❯ Yes
    Allow edits this session
    No

● Running npm test

  ✓ 142 tests

● Running npm run build

  ✓ build succeeded

● Reviewing git diff

  1 file changed

> _
────────────────────────────────────────────────────────────────
model | context usage | changed files | session status
```

The UI should render tool actions clearly enough that a user can understand what the agent is doing.

---

## 39. Streaming

Preserve Venice streaming functionality.

The UI should distinguish:

- model text;
- tool request;
- approval request;
- tool execution;
- tool result;
- error;
- final answer.

Do not intermix raw internal JSON into normal output unless debug mode is enabled.

---

## 40. Cancellation

Implement reliable cancellation.

Ctrl+C behavior should be well-defined.

Possible behavior:

First Ctrl+C:

```text
cancel current model/tool operation
```

Second Ctrl+C:

```text
exit session
```

Do not leave child processes running after cancellation.

Shell execution must clean up spawned processes.

---

## 41. Model Picker

Add:

```text
/model
```

with live Venice model discovery.

Display useful capabilities when available.

Example:

```text
Kimi K2.5
128K context
Tools: yes
Reasoning: yes
Privacy: private
```

Do not invent metadata not returned by Venice.

---

## 42. Venice Privacy Features

Surface existing Venice security/privacy capabilities prominently.

Where supported, expose:

```text
E2EE status
TEE status
TEE attestation verification
private model metadata
```

Potential `/status` output:

```text
Model: ...
API: Venice
Session: ...
Workspace: ...
E2EE: enabled
TEE: verified
Approval mode: auto-edit
```

Never display a security property as verified if verification has not actually occurred.

---

## 43. Venice Search as Agent Tool

Convert existing Venice search/scrape functionality into agent-accessible tools without duplicating network implementations.

The agent should be able to perform tasks like:

```text
Research the latest upstream API documentation, compare it
against this repository, and update stale references.
```

Tool results should include usable source metadata.

---

## 44. Venice Media as Agent Tools

Eventually expose current Venice media functionality through the agent tool registry.

Examples:

```text
generate_image
edit_image
generate_video
image_to_video
transcribe
text_to_speech
```

This allows workflows such as:

```text
Create a README hero image using the project's branding,
save it under docs/assets, then update README.md.
```

The same workspace permission and persistence rules must apply.

---

## 45. Structured Output

Preserve existing structured-output support.

Where useful internally, use schemas for:

- summaries;
- plans;
- validation results;
- subagent reports;
- tool arguments.

Do not require every model response to use rigid structured output.

---

## 46. Checkpoints

After the core agent runtime is stable, implement local checkpoints.

Possible checkpoint data:

```text
file path
original hash
new hash
patch
timestamp
operation id
```

Potential commands:

```text
/checkpoints
/undo
/redo
```

Do not rely solely on Git commits for undo.

Do not create commits automatically unless requested.

---

## 47. Subagents

Subagents are not Phase 1.

Do not build multi-agent orchestration before the primary agent is reliable.

When implemented, start with read-only subagents.

Potential types:

```text
Explore
Review
Research
Test
General
```

Suggested interface:

```ts
spawn_agent({
  task: "...",
  mode: "read-only"
})
```

Each subagent should have:

```text
separate conversation
separate context budget
restricted tool set
same workspace snapshot or explicitly defined view
structured result
```

Subagents should not silently modify the workspace during the first implementation.

---

## 48. Subagent Result Contract

Return concise structured findings such as:

```ts
interface SubagentResult {
  summary: string;

  findings: {
    severity?: string;
    file?: string;
    line?: number;
    description: string;
  }[];

  recommendations: string[];

  filesInspected: string[];
}
```

Do not dump an entire nested conversation into parent context.

---

## 49. Noninteractive Mode

Support automation use cases.

Examples:

```bash
venice agent -p "Run the tests and explain failures."
```

Potential flags:

```text
--model
--approval
--cwd
--add-dir
--json
--quiet
--max-turns
```

Noninteractive mode must:

- produce deterministic exit codes;
- handle approval requirements cleanly;
- avoid hanging while waiting for impossible interactive input.

---

## 50. Exit Codes

Define stable exit semantics.

Example:

```text
0 = completed successfully
1 = agent/task failure
2 = CLI/configuration error
3 = permission denied
4 = validation failure
5 = cancelled
```

Final values may differ, but document them.

---

## 51. Error Model

Normalize major error categories.

Examples:

```text
Venice API error
authentication error
rate limit
network error
tool error
permission error
filesystem error
shell timeout
shell failure
context overflow
invalid configuration
MCP startup failure
MCP tool failure
session corruption
```

Do not surface raw stack traces by default.

Provide verbose/debug mode.

---

## 52. Debug Mode

Add a useful debug mode, for example:

```bash
venice --debug
```

It may expose:

- request lifecycle;
- tool timing;
- MCP startup logs;
- context estimates;
- event IDs;
- stack traces.

Do not print secrets even in debug mode.

---

## 53. Configuration

Create a coherent configuration hierarchy.

Possible precedence:

```text
defaults
↓
global config
↓
workspace config
↓
environment
↓
CLI arguments
```

Document it.

Avoid config behavior that depends on accidental object merge order.

---

## 54. Global Configuration

Determine the current Venice CLI config location before introducing new paths.

If no suitable structure exists, consider:

```text
~/.config/venice/
├── config.json
├── AGENTS.md
├── mcp.json
└── skills/
```

Preserve compatibility with current API-key/config storage.

Do not expose API credentials in new plaintext config files if current implementation stores them more securely.

---

## 55. Compatibility

Existing Venice CLI behavior is a compatibility contract unless evidence shows a breaking change is necessary.

Before changing shared code, test:

```text
chat
models
search
image
video
audio
E2EE
TEE
structured output
history
attachments
function calling
```

where applicable.

Agent development must not regress existing commands.

---

## 56. Package Runtime

Inspect the actual Node version support before changing it.

Do not arbitrarily raise minimum Node requirements.

If a newer runtime is necessary:

1. document the reason;
2. evaluate ecosystem support;
3. update CI;
4. update package metadata;
5. update installation docs;
6. test clean installation.

---

## 57. Dependency Policy

Avoid dependency inflation.

Before adding a library, determine:

- can existing dependencies handle this?;
- is the package maintained?;
- does it introduce native build requirements?;
- does it work on macOS/Linux/Windows?;
- does it affect CLI startup time?;
- is it necessary in production or only development?

Keep runtime dependencies intentionally small.

---

## 58. Platform Support

Do not design only for macOS.

The agent should remain viable on:

```text
macOS
Linux
Windows
WSL
```

Consider:

- path separators;
- shell selection;
- executable resolution;
- environment variables;
- terminal capabilities;
- child-process behavior;
- filesystem permission differences.

Avoid Unix-only assumptions unless explicitly isolated.

---

## 59. Shell Selection

Do not assume `/bin/bash`.

Determine appropriate shell behavior per platform.

Potential rules:

```text
macOS/Linux:
user shell or explicit `/bin/sh` strategy

Windows:
PowerShell or existing process execution strategy

WSL:
normal Linux behavior
```

The exact implementation must be tested.

---

## 60. Testing Strategy

Every new subsystem requires tests.

At minimum:

### Tool Registry

Test:

- registration;
- duplicate names;
- schema validation;
- tool lookup;
- tool failures;
- source metadata.

### Workspace

Test:

- Git root detection;
- non-Git directories;
- symlinks;
- nested repositories;
- external paths.

### Permissions

Test:

- read;
- write;
- execute;
- network;
- destructive operations;
- session-specific grants.

### Sessions

Test:

- create;
- persist;
- resume;
- corrupt data;
- concurrent access;
- deletion;
- export.

### Context

Test:

- budget estimation;
- compaction trigger;
- important-state retention;
- oversized tool output.

### Shell

Test:

- success;
- failure;
- timeout;
- stderr;
- cancellation;
- working directory.

### File Editing

Test:

- normal edits;
- stale content;
- UTF-8;
- CRLF;
- missing file;
- write failure.

### Instructions

Test:

- global;
- repository;
- nested;
- precedence;
- missing files.

### MCP

Test:

- process startup;
- discovery;
- tool conversion;
- execution;
- process crash;
- timeout;
- malformed response.

---

## 61. Integration Tests

Create realistic agent-loop tests using mock model responses.

Example:

```text
User asks to inspect package.json.

Model requests read_file.

Tool returns package.json.

Model requests shell npm test.

Permission is approved.

Shell returns failure.

Model reads failing test file.

Model applies patch.

Model reruns test.

Model returns final answer.
```

Verify the entire event sequence.

Do not require paid API access for the majority of agent runtime tests.

---

## 62. Venice API Integration Tests

Separate live Venice API tests from deterministic unit tests.

Live tests should be:

- explicitly opt-in;
- skipped without credentials;
- documented;
- minimal enough to avoid excessive API usage.

---

## 63. CI

Update CI to validate:

```text
install
typecheck
lint
unit tests
integration tests
build
package
```

If multi-platform workflows already exist, preserve and extend them.

If they do not exist, establish appropriate coverage.

Do not knowingly merge an agent runtime that only builds on the developer's local machine.

---

## 64. Documentation

Update documentation incrementally.

Required eventual documentation:

```text
README.md
docs/agent.md
docs/tools.md
docs/permissions.md
docs/sessions.md
docs/context.md
docs/mcp.md
docs/skills.md
docs/configuration.md
docs/security.md
docs/development.md
```

Do not document features before they actually work.

---

## 65. README Positioning

The README should eventually explain that Venice CLI now supports:

```text
API utilities
interactive chat
workspace-aware agent execution
MCP
skills
Venice media
Venice search
privacy-oriented Venice model features
```

Keep installation and quick-start instructions concise.

Move deep detail into `/docs`.

---

## 66. CLI Help

Every command and flag must have accurate help output.

Examples:

```bash
venice --help
venice agent --help
venice mcp --help
venice skills --help
venice sessions --help
```

Test help output.

---

## 67. Performance

Monitor:

```text
cold startup
interactive startup
model-selection latency
workspace discovery
file search
context building
session load
MCP startup
```

Do not eagerly scan every repository file during startup.

Prefer lazy discovery.

---

## 68. Large Repository Handling

The agent must remain usable in large repositories.

Avoid:

```text
recursive full-file ingestion
full node_modules scans
loading every Git-tracked file
injecting every instruction/skill body
unbounded grep results
unbounded command logs
```

Use limits and pagination/truncation.

---

## 69. Search Strategy

Local search should prefer efficient filesystem primitives.

If invoking external commands such as `rg`, provide fallback behavior or clearly document the dependency.

Do not silently require tools absent from standard installations unless the CLI manages them explicitly.

---

## 70. Agent Prompt Contract

Create a dedicated built-in agent contract.

It should establish rules such as:

```text
Inspect before editing.

Never invent file contents.

Never invent tool results.

Never claim tests passed unless they were run successfully.

Use repository instructions.

Prefer minimal changes.

Preserve user work.

Do not overwrite unrelated changes.

Validate after edits.

Inspect final diff.

Report unresolved failures.

Ask for approval when required by permission policy.

Do not disclose secrets.

Use actual source files rather than stale summaries when correctness matters.
```

Keep this core prompt centralized and version-controlled.

Do not scatter behavior rules through UI components.

---

## 71. No Hidden Reasoning Requirement

The runtime must not depend on receiving private chain-of-thought from the model.

Agent orchestration must work from:

- normal assistant messages;
- tool calls;
- structured state;
- externally visible plans/todos where applicable.

Do not design around undocumented model internals.

---

## 72. Agent Loop Limits

Introduce configurable safeguards.

Potential settings:

```text
max turns
max tool calls
max shell runtime
max context utilization
max consecutive failures
```

Defaults should allow substantial work without permitting accidental infinite loops.

When a limit is reached, preserve the session and explain what stopped.

---

## 73. Retry Policy

Implement bounded retry behavior for transient failures.

Possible retry candidates:

```text
network timeout
rate limit
temporary Venice API error
MCP process startup race
```

Do not retry deterministic failures indefinitely.

Backoff should be bounded.

---

## 74. Rate Limits

Surface Venice rate-limit failures accurately.

If headers expose retry information, use it.

Do not repeatedly hammer the endpoint.

---

## 75. Tool Output Truncation

Large shell or search results must be safely truncated.

Preserve:

```text
beginning
ending
total size
truncated indicator
```

where useful.

Do not silently truncate without telling the model.

---

## 76. Binary Files

Do not inject arbitrary binary data into text context.

Detect binary files.

Return metadata such as:

```text
path
size
mime/type if known
```

Use dedicated multimodal attachment pathways only where supported.

---

## 77. User Attachments

Preserve and adapt current Venice CLI attachment functionality.

The agent should be able to reason over explicitly attached supported files without converting every attachment into raw uncontrolled prompt text.

---

## 78. User Experience for Changes

After file edits, show concise state such as:

```text
3 files changed
+124
-31
```

Provide `/diff`.

Do not flood the terminal with full patches unless requested or approval requires it.

---

## 79. Final Agent Response Contract

After coding work, the agent should normally summarize:

```text
what changed
what was validated
what failed
what remains
```

Example:

```text
Implemented the workspace tool registry and permission engine.

Validation:
- npm test: PASS
- npm run typecheck: PASS
- npm run build: PASS

Changed:
- src/agent/runtime.ts
- src/tools/registry.ts
- src/agent/permissions.ts

No unresolved failures.
```

Never report success unsupported by evidence.

---

## 80. Development Phases

Use phased delivery.

### Phase 0 — Baseline and Architecture

Deliver:

- repository inventory;
- baseline test/build results;
- architecture document;
- dependency analysis;
- implementation roadmap;
- identified compatibility constraints.

No large refactor yet.

### Phase 1 — Agent Core

Implement:

- reusable Venice model client abstraction;
- `AgentRuntime`;
- agent event types;
- tool registry;
- basic iterative tool loop;
- mock-model tests.

Acceptance:

- multiple sequential tool calls work;
- runtime is independent of terminal UI;
- existing chat command still works.

### Phase 2 — Workspace Tools

Implement:

```text
read_file
read_many_files
list_directory
glob
grep
write_file
edit_file
apply_patch
```

Acceptance:

- path traversal tests pass;
- external workspace access is controlled;
- agent can inspect and modify a fixture repository.

### Phase 3 — Permissions and Shell

Implement:

- permission manager;
- approval scopes;
- shell tool;
- cancellation;
- timeout handling.

Acceptance:

- risk-sensitive approval flow works;
- shell results preserve real exit status;
- cancellation kills child processes.

### Phase 4 — Git and Validation

Implement:

```text
git_status
git_diff
git_log
validation command detection
```

Acceptance:

- agent can inspect changes before completion;
- pre-existing dirty work is preserved;
- Git operations are read-only by default.

### Phase 5 — Instructions and Workspace Intelligence

Implement:

```text
AGENTS.md
VENICE.md
.venice/instructions.md
nested instructions
venice init
```

Acceptance:

- precedence tests pass;
- relevant instructions appear in agent context;
- unrelated nested instructions do not leak across paths.

### Phase 6 — Sessions and Context

Implement:

- session persistence;
- JSONL events;
- resume;
- context budget;
- compaction;
- structured summaries.

Acceptance:

- interrupted session resumes correctly;
- compaction preserves objective and changed-file state;
- no API keys are written into transcripts.

### Phase 7 — Interactive UI

Implement:

- persistent prompt;
- transcript;
- streaming;
- approvals;
- status line;
- todos;
- model picker;
- slash commands.

Acceptance:

- runtime works identically without UI;
- UI does not contain business logic;
- Ctrl+C behavior is correct.

### Phase 8 — MCP

Implement:

- MCP config;
- process lifecycle;
- discovery;
- normalized tool registry;
- permissions.

Acceptance:

- at least one reference MCP server can connect;
- MCP failure does not crash the entire agent session.

### Phase 9 — Skills

Implement:

- skill discovery;
- metadata parsing;
- progressive loading;
- global/project scopes.

Acceptance:

- matching skill can be selected and loaded;
- inactive skills do not consume full context.

### Phase 10 — Venice-Native Agent Tools

Expose:

```text
search
scrape
images
image editing
video
audio
other currently supported Venice media APIs
```

Reuse existing implementations.

Acceptance:

- no API logic duplication;
- media output integrates with workspace and session state.

### Phase 11 — Checkpoints

Implement:

```text
checkpoints
undo
redo
```

Acceptance:

- file edits can be reversed safely;
- unrelated user changes are preserved.

### Phase 12 — Subagents

Implement read-only subagents.

Acceptance:

- separate context;
- restricted tools;
- bounded runtime;
- structured return;
- no workspace writes.

Only after this phase is stable should write-capable subagents be evaluated.

---

## 81. First Milestone Scope

Do **not** attempt all phases in one unreviewable change.

The first meaningful milestone should deliver:

```text
AgentRuntime
ToolRegistry
WorkspaceManager
PermissionManager
read_file
glob
grep
apply_patch/edit
shell
git_status
git_diff
basic session state
basic agent command
mock agent-loop tests
```

This is the point where Venice CLI should first genuinely behave like an agent.

---

## 82. First Milestone Acceptance Scenario

The following scenario must work:

```text
$ cd example-typescript-project

$ venice agent

> Fix the failing TypeScript build.

Agent:
- discovers repository
- reads package.json
- finds build command
- runs or requests approval for build
- observes compiler failure
- locates source file
- reads source file
- edits source file
- reruns build
- verifies success
- runs relevant tests if available
- checks git diff
- reports exact result
```

The runtime must perform more than a single tool round.

---

## 83. Security Acceptance Scenario

The following must be prevented or explicitly approved:

```text
> Read ~/.ssh/id_ed25519
```

The agent must recognize this as outside the normal workspace boundary.

Likewise:

```text
> rm -rf /
```

must not execute merely because the agent has shell access.

---

## 84. Dirty Workspace Acceptance Scenario

Given:

```text
M src/user-work.ts
```

before the agent starts, the agent must:

- recognize existing modification;
- avoid erasing it;
- distinguish pre-existing changes from its own changes;
- report conflicts rather than silently overwrite.

---

## 85. Failure Acceptance Scenario

If:

```bash
npm test
```

returns exit code `1`, the final response must not say:

```text
All tests pass.
```

The model/tool/runtime stack must preserve execution truth.

---

## 86. Compatibility Acceptance Scenario

After adding the agent runtime, existing commands should still function according to their prior contract.

At minimum verify command registration and execution paths for all major existing CLI functionality.

---

## 87. Code Quality

Requirements:

- TypeScript strictness should not be weakened to get features compiling.
- Avoid `any` unless justified.
- Avoid giant orchestration classes.
- Use dependency injection where it materially improves testability.
- Keep pure logic separate from process/terminal I/O.
- Keep tool implementations small.
- Keep transport separate from orchestration.
- Avoid circular dependencies.
- Document non-obvious security boundaries.

---

## 88. Do Not

Do not:

- rewrite the project from scratch;
- migrate to Rust/Go just because other CLIs use them;
- replace the Venice API layer unnecessarily;
- break working existing commands;
- hard-code model lists when live model discovery exists;
- hard-code context windows without evidence;
- give unrestricted filesystem access by default;
- give unrestricted shell access by default;
- invent test results;
- invent tool results;
- hide execution failures;
- assume Unix-only behavior;
- dump all repository files into context;
- load every skill in full;
- load every MCP tool description repeatedly if unnecessary;
- build subagents before the primary runtime is stable;
- build the TUI before the runtime works;
- silently add telemetry;
- store API keys in session transcripts;
- auto-commit or auto-push without explicit authorization;
- reset or clean user work;
- use `git reset --hard` as a convenience;
- suppress errors to make tests green;
- weaken TypeScript/compiler configuration to bypass bugs;
- skip validation because the change “looks correct.”

---

## 89. Implementation Discipline

For every implementation unit:

1. inspect affected files;
2. determine existing contracts;
3. write or update tests;
4. make the smallest coherent change;
5. run focused tests;
6. run relevant broader validation;
7. inspect Git diff;
8. document any unresolved issue.

Avoid large speculative refactors.

---

## 90. Architecture Documentation

Create:

```text
docs/architecture/agent-runtime.md
```

It should explain:

- runtime lifecycle;
- state ownership;
- message flow;
- tool registry;
- permission boundary;
- workspace boundary;
- context model;
- event model;
- session persistence;
- UI/runtime separation;
- MCP integration path;
- future subagent architecture.

Include Mermaid diagrams if the repository documentation style permits.

---

## 91. Decision Records

For major irreversible choices, create architecture decision records if the project does not already have an equivalent.

Suggested examples:

```text
ADR-001 Agent runtime boundary
ADR-002 Tool abstraction
ADR-003 Session persistence
ADR-004 Terminal UI framework
ADR-005 MCP transport architecture
```

Do not generate ADR bureaucracy for minor implementation details.

---

## 92. Progress Reporting

Maintain a development status document during this initiative.

Suggested:

```text
docs/agent-development-status.md
```

Track:

```text
implemented
in progress
not started
blocked
deferred
```

Every entry should point to real code/tests rather than vague percentages.

---

## 93. Required Initial Deliverables

Before significant implementation, produce:

```text
1. BASELINE_REPORT.md
2. AGENT_ARCHITECTURE.md
3. AGENT_IMPLEMENTATION_PLAN.md
4. AGENT_RISK_REGISTER.md
```

These may live under an appropriate project documentation directory.

The baseline report must include:

```text
commit SHA
branch
working-tree state
Node version
package-manager version
install result
typecheck result
lint result
test result
build result
existing failures
```

---

## 94. Risk Register

At minimum evaluate:

```text
context explosion
workspace escape
destructive shell commands
secret leakage
session transcript leakage
stale edit conflicts
tool hallucination
false validation success
MCP trust
MCP process leakage
cross-platform incompatibility
terminal corruption
child process leakage
API rate limits
model capability mismatch
backward compatibility
large-repository performance
session corruption
subagent conflicts
```

For each risk record:

```text
severity
likelihood
mitigation
validation/test
```

---

## 95. Definition of a Real Agent CLI

Do not declare success merely because the CLI supports function calling.

The product qualifies as a functional agent CLI only when it can:

```text
understand a workspace
inspect files
search code
modify files
execute commands
observe command results
iterate based on results
maintain task state
respect permissions
validate changes
resume work
manage context
report evidence
```

Everything else is an extension of this core.

---

## 96. Desired Long-Term User Experience

The eventual experience should approach:

```bash
cd ~/Projects/my-app
venice
```

Then:

```text
> Audit this repository, fix the broken tests, update stale
> Venice API usage against official docs, and verify the build.
```

The agent should be able to:

```text
inspect repository
read instructions
discover toolchain
create todo state
search source
consult official Venice sources when needed
identify failures
edit code
run tests
observe failures
iterate
run typecheck/lint/build
review Git diff
summarize evidence
```

without the user manually orchestrating each individual API request.

---

## 97. Venice-Specific Differentiation

Do not make this merely a clone of another coding agent.

Venice CLI can differentiate itself through:

```text
Venice-native privacy
E2EE
TEE
live model catalog
private inference options
Venice search
Venice scrape
image generation
image editing
video
audio
multimodal workflows
local session auditability
MCP
skills
coding-agent capabilities
```

A future Venice agent should be useful for both:

```text
software development
general agent workflows
research
media creation
automation
```

while using one consistent permission and tool architecture.

---

## 98. Immediate Engineering Task

Begin now with **Phase 0 and Phase 1**.

Do not jump directly into MCP, skills, subagents, or a large TUI.

First:

1. inspect the entire current repository;
2. establish the baseline;
3. identify reusable API/model/tool code;
4. define the runtime boundaries;
5. create architecture documentation;
6. implement the reusable `AgentRuntime`;
7. implement the initial tool registry abstraction;
8. add deterministic agent-loop tests;
9. preserve all existing CLI behavior;
10. validate the repository after the first milestone.

If implementation reveals that assumptions in this handoff do not match the actual repository, follow repository evidence rather than blindly following the proposed filenames or module tree.

Record the divergence and explain why.

---

## 99. Final Handoff Requirement

At the end of each milestone, report:

```text
Milestone
Commit/base SHA
Files changed
Architecture changes
Features implemented
Tests added
Commands executed
Validation results
Known failures
Deferred items
Next milestone
```

Do not use statements such as:

```text
should work
appears fixed
probably passes
```

when the result can be directly verified.

Use:

```text
PASS
FAIL
NOT RUN
BLOCKED
```

with supporting command evidence.

---

## 100. Success Criteria

The project is on the correct trajectory when the following command becomes genuinely useful:

```bash
venice
```

and a user can ask:

```text
Fix this repository.
```

with Venice CLI able to safely and transparently:

```text
inspect
reason
act
verify
iterate
report
```

using the Venice API as its intelligence layer while maintaining a robust local agent runtime around it.

Build toward that architecture deliberately.

Do not optimize for demo behavior.

Optimize for correctness, observability, security boundaries, extensibility, testability, compatibility, and long-term maintainability.
