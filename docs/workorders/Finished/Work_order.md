# Venice CLI — Live Main Exhaustive Repair Agent Handoff

**Date:** 2026-08-16  
**Repository:** `https://github.com/spearchucker667/venice-cli`  
**Local repository:** `/Users/super_user/Projects/venice-cli/`  
**Branch under audit:** `main`  
**Audited live commit:** `a87035071ae513eafc3e661e4db01742a52fec07`

> If `origin/main` has advanced beyond the audited SHA, treat the newer live commit as authoritative, record the new SHA, and revalidate each finding before modifying code.

---

# 1. Mission

Repair and harden the current Venice CLI implementation as a production-grade interactive agent CLI.

Do not treat this as a cosmetic slash-command addition.

The live audit found interconnected defects spanning:

1. model response delivery;
2. streaming;
3. terminal error propagation;
4. transcript reconstruction;
5. SSE parsing;
6. slash-command registration and routing;
7. duplicated model-selection UX;
8. configuration/settings architecture;
9. runtime permission modes;
10. MCP management;
11. plugins;
12. themes;
13. reload semantics;
14. media safety configuration;
15. unfinished exposed functionality;
16. CI;
17. cross-platform behavior;
18. security and secret handling.

The highest priority is restoring reliable LLM output and making CI authoritative again.

---

# 2. Operating Rules

Work from evidence.

Before editing:

```bash
cd "/Users/super_user/Projects/venice-cli"

git status --short
git branch --show-current
git rev-parse HEAD
git rev-parse origin/main
git log -10 --oneline --decorate

node --version
npm --version

node -e 'console.log(require("./package.json").scripts)'
```

Then inspect:

```text
package.json
.github/workflows/
src/ui/
src/agent/
src/lib/
src/mcp/
src/skills/
tests/
```

Do not assume historical audit documents describe the current implementation.

Historical documents in the repository may be useful context, but live source plus reproducible behavior wins whenever they disagree.

Do not begin broad refactoring before reproducing the P0 behavior.

---

# 3. Current User-Reported Failures

The live application currently needs or appears to need:

```text
/config
/settings
/yolo
/auto
/plan
/effort
/compact
/new
/sessions
/mcp
/reload
/plugins
/theme
/init
```

Additionally:

- two model-selection choices are visible;
- streamed replies are not resulting in visible LLM output;
- CI workflows are failing.

Several requested commands already exist in the current implementation. Do not reimplement them independently.

---

# 4. Verified Slash-Command State

Current registry:

```text
src/ui/slash-commands.ts
```

Current handlers:

```text
src/ui/slash-handlers.ts
```

Already implemented or registered:

```text
/help
/quit
/clear
/clear-ui
/status
/model
/models
/resume
/sessions
/diff
/review
/plan
/compact
/tools
/mcp
/skills
/skill
/permissions
/git
/init
/context
/new
/fork
/title
/rename
/export
/export-debug-zip
/import
```

The requested commands already substantially present are therefore:

```text
/plan
/compact
/new
/sessions
/mcp
/init
```

Do not create duplicate implementations for these.

Missing requested top-level commands:

```text
/config
/settings
/yolo
/auto
/effort
/reload
/plugins
/theme
```

---

# 5. Severity Summary

## P0 — Release blockers

### VCLI-LIVE-001 — Model/API failures can result in no visible output

Confirmed runtime defect.

Relevant files:

```text
src/agent/runtime.ts
src/ui/app.tsx
src/ui/events.ts
```

`AgentRuntime.processTurns()` catches model/API errors and converts them into a returned value resembling:

```text
Agent failed: ...
```

However, that failure is not reliably emitted into the UI event stream or persisted as an assistant/error message.

The TUI invokes the runtime asynchronously but renders model output primarily from emitted events.

Therefore:

```text
model request fails
        ↓
runtime catches exception
        ↓
runtime resolves Promise with "Agent failed: ..."
        ↓
UI Promise .catch() never executes
        ↓
returned string is ignored
        ↓
user sees no LLM output
```

This is a direct explanation for at least one class of the reported blank-response failure.

### Required repair

Define one canonical terminal-response contract.

Prefer typed events such as:

```ts
assistant_delta
assistant_complete
assistant_error
```

Every model turn must end in exactly one terminal state:

```text
assistant_complete
OR
assistant_error
OR
explicit cancellation
```

Never silently convert an exception into an unconsumed successful Promise value.

Do not rely solely on Promise rejection for rendering errors.

Persist or otherwise retain terminal failures sufficiently for session diagnostics.

---

## VCLI-LIVE-002 — Streaming completion semantics are unsafe

Relevant files:

```text
src/agent/runtime.ts
src/agent/model-client.ts
src/lib/api.ts
```

The runtime emits incremental `assistant_delta` events.

The model-client streaming path then reports a boolean equivalent to:

```text
streamed: true
```

The runtime uses that flag to avoid re-emitting the final full assistant response.

The problem is that:

```text
streamed === true
```

currently means approximately:

```text
the streaming transport/code path was selected
```

rather than:

```text
visible assistant content was successfully delivered to the UI
```

Those are not equivalent.

A stream can legally or accidentally produce:

- no content chunks;
- usage-only events;
- reasoning/tool events;
- parser-dropped events;
- an API error;
- a connection terminating before content;
- malformed frames.

The current architecture can therefore suppress the authoritative final response even though no visible text was rendered.

### Required repair

Replace ambiguous `streamed` semantics with explicit state, for example:

```text
receivedContentDelta
contentDeltaCount
streamCompleted
terminalReason
```

More importantly, emit an authoritative final event:

```ts
assistant_complete
```

containing:

- turn/message ID;
- final canonical content;
- model;
- completion metadata if appropriate.

The UI should reconcile the partial streamed buffer with this canonical final message.

Streaming is presentation.

The completed assistant message is state.

Do not make persisted conversation correctness depend on every UI delta being received.

---

## VCLI-LIVE-003 — Transcript truncation can remove the beginning of long streamed answers

Relevant file:

```text
src/ui/transcript.tsx
```

Current rendering performs raw event/message limiting before fully reconstructing adjacent streaming chunks.

Conceptually:

```text
slice to N raw items
        ↓
merge assistant deltas
```

This is wrong for streamed output.

If a response generates more raw deltas than the transcript limit, the initial chunks can disappear before reconstruction.

A long assistant answer can therefore appear as only its tail.

Reasoning/tool events can also break adjacency.

### Required repair

Treat one assistant turn as one logical transcript object.

Preferred model:

```text
turn/message ID
    ├── partial text buffer
    ├── reasoning state
    ├── tool activity
    └── authoritative final assistant content
```

Apply transcript limits to logical messages/turns, not transport events.

At minimum:

```text
coalesce first
slice second
```

But message-ID-based reconciliation is preferable.

---

## VCLI-LIVE-004 — SSE parser is too brittle

Relevant file:

```text
src/lib/api.ts
```

The streaming parser currently makes assumptions around line-oriented `data: ` framing.

At minimum, the implementation must not require the optional space after the SSE `data:` field.

It also needs explicit testing for incomplete buffers at EOF.

### Required test corpus

Add deterministic parser tests covering:

```text
data: {...}

data:{...}

LF
CRLF

multiple SSE frames in one network read

one SSE frame split across multiple reads

JSON split at arbitrary byte boundaries

UTF-8 multibyte character split between reads

SSE comment/heartbeat lines beginning with ":"

empty events

usage-only events

reasoning-only events

tool-call deltas

content deltas

[DONE]

final event without trailing newline

reader EOF with residual buffered data

zero-content successful response

malformed JSON

provider/API error payload

network termination

AbortSignal cancellation
```

Do not silently discard malformed provider responses.

Attach useful sanitized context to parser errors.

Do not log API keys or authorization headers.

---

## VCLI-LIVE-005 — CI is broadly red

Latest inspected `main` Actions run:

```text
Run ID: 31988790242
```

Observed failing jobs included:

```text
Quality
Node 18 / Linux
Node 18 / Windows
Node 20 / Linux
Node 20 / Windows
Node 22 / Linux
Node 22 / Windows
```

This is not consistent with a single Windows-specific or Node-version-specific flake.

Some later acceptance jobs are consequently blocked/skipped.

Relevant configuration:

```text
.github/workflows/ci.yml
package.json
```

### Required approach

Do not start by editing the matrix until the first independent error is understood.

For each of these categories:

```text
Quality
one Linux runtime lane
one Windows runtime lane
```

identify the first substantive failing command.

Classify failures as:

```text
root failure
duplicate failure
cascading failure
environment failure
real product regression
```

Fix root causes first.

Do not weaken the workflow merely to obtain green checks.

Do not remove supported Node versions simply because a test currently fails.

If actual dependency requirements have changed, update the support policy deliberately and document the evidence.

---

# 6. P1 — Slash-Command Architecture

## VCLI-LIVE-006 — `/model` and `/models` duplicate the model-selection UX

Both currently lead to the same model picker.

This appears to explain the reported duplicate model-selection choices.

Canonicalize:

```text
/model
```

Retain:

```text
/models
```

only as a compatibility alias if desired.

It should not appear as a second identical item in autocomplete/help.

The command schema should support metadata such as:

```ts
{
  name: "model",
  aliases: ["models"],
  visible: true
}
```

rather than defining identical visible commands independently.

Apply the same alias architecture wherever appropriate.

---

# 7. VCLI-LIVE-007 — Unknown slash commands fall through too easily

A mistyped slash command should not normally become an LLM user message.

Example:

```text
/setings
```

should not be sent to the model as arbitrary conversation text.

Implement local unknown-command handling:

```text
Unknown command: /setings
Did you mean /settings?
```

Use nearest-command matching.

If slash-leading literal user content is required, provide an intentional escape mechanism.

This prevents:

- command typos contaminating conversation context;
- unnecessary API calls;
- confusing behavior;
- potential accidental prompt content.

---

# 8. Implement `/auto` and `/yolo` as Runtime-Mode Routes

Current `/permissions` support already includes runtime modes including concepts equivalent to:

```text
suggest
auto-edit
auto
yolo
```

Therefore do not build new independent permission systems.

Implement:

```text
/auto
/yolo
```

as first-class ergonomic routes into the existing permission/runtime-mode state.

Expected behavior:

```text
/auto
→ activate existing auto mode

/yolo
→ activate existing yolo mode
```

The command should clearly display the new mode.

### YOLO safety/state requirements

`/yolo` must never activate through fuzzy matching.

It must never activate because the model produced `/yolo`.

Only local user command handling may change that state.

Do not silently make YOLO the default.

Do not accidentally persist it globally unless persistence is an explicit product decision.

On session restore, make the active mode visible.

---

# 9. Implement `/config`

User requirement:

> menu for opening model system prompts, rules, etc.

`/config` should be an interactive configuration hub, not merely dump JSON.

At minimum identify and expose the actual configuration layers present in the project.

Potential categories:

```text
Global CLI config
Project/assistant instructions
Rules
System prompt/instructions
Model configuration
Skills configuration
MCP configuration
Relevant project files
```

Only expose categories backed by real files/state.

Do not invent placeholder configuration.

For each entry show:

```text
name
scope
effective path/source
read-only vs editable
reload behavior
```

If opening external editors/files:

- support macOS, Linux, and Windows;
- use argument-safe process spawning;
- never concatenate shell commands from paths;
- handle spaces safely;
- report missing `$EDITOR`;
- optionally fall back to `$VISUAL` or an internal viewer.

Before writes:

- validate;
- use an atomic write;
- preserve permissions;
- maintain a safe backup where appropriate.

---

# 10. Implement `/settings`

`/settings` should manage user-facing runtime/preferences rather than prompt/rules files.

Candidate settings include only features actually supported:

```text
API key
default model
runtime mode
media safe mode
theme
reasoning effort
other stable application preferences
```

### API key requirements

The API key is sensitive.

Never render a stored full key.

Use masking such as:

```text
venice_****abcd
```

where appropriate.

Do not:

- place the full key into transcript history;
- include it in debug exports;
- include it in thrown diagnostic text;
- log Authorization headers;
- expose it in `/settings show`.

Validate changes before replacing the active credential.

If the model client must be reconstructed after credential changes, do so deliberately.

---

# 11. VCLI-LIVE-008 — Media Safe Mode is not currently a complete feature

The audit did not locate a complete media-safety setting/enforcement path corresponding to the requested `/settings` option.

Do not add:

```ts
safeMode: true
```

to config and call the feature complete.

Establish the real provider/API contract first.

Use Venice's current official API documentation as the source of truth:

```text
https://github.com/veniceai/api-docs
https://docs.venice.ai
```

Determine:

1. what media endpoints expose;
2. what relevant safety parameters actually exist;
3. which media modalities/models support them;
4. expected defaults;
5. what the setting changes in outgoing requests.

Then implement enforcement centrally in the media request construction layer.

Add tests proving that changing the setting changes the applicable request.

For unsupported endpoints/models, report that explicitly rather than silently pretending the option applied.

---

# 12. Implement `/effort`

No complete reasoning-effort UX/state path was found equivalent to the requested command.

First determine which supported Venice models expose a reasoning-effort-like parameter.

Do not blindly inject:

```json
{"reasoning_effort":"high"}
```

into every model request.

Implement capability-aware validation.

Possible UX:

```text
/effort
/effort low
/effort medium
/effort high
/effort auto
```

The actual accepted values must come from the current provider/API contract.

Define scope explicitly:

```text
session
model
global default
```

A session-level value is generally safer than silently mutating all future sessions unless existing architecture dictates otherwise.

Display effective effort in `/status` if enabled.

---

# 13. Implement `/reload`

`/reload` must have transactional semantics.

Potential resources:

```text
config
rules/instructions
skills
MCP config
plugins
theme
model metadata
```

Define what is actually reloadable.

Correct reload flow:

```text
read changed resources
        ↓
parse
        ↓
validate
        ↓
build replacement state
        ↓
only if successful:
atomically swap live state
```

If validation fails:

```text
keep last-known-good runtime state
report exact failing resource
do not corrupt the active session
```

Do not use `/reload` as a disguised `/new`.

Conversation/session state should survive unless explicitly documented otherwise.

Return a concise result, for example:

```text
Reloaded:
  config
  rules
  skills

Unchanged:
  current session
  current transcript

Failed:
  MCP server "foo": invalid command
```

---

# 14. Implement `/plugins` from a Real Product Definition

The repository already contains concepts for:

```text
skills
MCP
```

but a conventional full plugin lifecycle was not evident from the live scan.

Do not simply rename `/skills` to `/plugins`.

First define whether Venice CLI "plugins" means:

1. an actual extension/module system;
2. an aggregation layer over MCP + skills;
3. another existing architecture not surfaced in the TUI.

If plugins are a new subsystem, define:

```text
discovery
metadata
enable
disable
configuration
lifecycle
reload
error isolation
versioning
permissions
install source
uninstall
```

If `/plugins` is intentionally a unified management surface, make the backing type visible:

```text
Skill
MCP server
Extension
```

Do not imply a capability exists if it is only a menu placeholder.

---

# 15. Implement `/theme`

The current audit did not identify a mature centralized TUI theme manager.

Do not implement this by scattering conditional colors across components.

First centralize semantic tokens such as:

```text
foreground
muted
accent
success
warning
error
selection
border
tool
reasoning
user
assistant
```

Then create a theme registry.

Possible UX:

```text
/theme
/theme list
/theme <name>
/theme reset
```

Preserve:

- terminal compatibility;
- legibility;
- dark/light terminal backgrounds;
- ANSI portability;
- reasonable contrast.

Persist the setting only through the normal settings/config mechanism.

---

# 16. VCLI-LIVE-009 — `/mcp` exists but needs a real management surface

Do not duplicate `/mcp`.

Expand the existing handler.

Target capabilities, where supported by the current MCP architecture:

```text
/mcp
/mcp list
/mcp status
/mcp inspect <server>
/mcp tools <server>
/mcp reload
/mcp enable <server>
/mcp disable <server>
```

If architecture safely supports lifecycle control, optionally expose:

```text
start
stop
restart
```

Configuration editing should be explicit.

Handle unavailable/failed MCP managers gracefully.

One dead MCP server must not crash the CLI startup or command menu.

Show actionable failures.

---

# 17. VCLI-LIVE-010 — Exposed `/export-debug-zip` is an unfinished command

The current slash-command surface advertises:

```text
/export-debug-zip
```

while its handler reports functionality equivalent to:

```text
Debug zip export is not yet implemented.
```

Do not leave visibly exposed production commands as stubs.

Choose one:

### Preferred

Implement it completely.

### Otherwise

Hide/remove it from public autocomplete/help until finished.

If implemented, debug export MUST redact:

```text
API keys
bearer tokens
auth headers
credentials
environment secrets
private config values
MCP credentials
provider tokens
```

Conversation contents should be handled deliberately rather than blindly included.

Clean temporary files after archive creation.

Add tests for secret redaction.

---

# 18. Streaming Architecture Target

Refactor toward a deterministic state machine.

Example:

```text
USER_MESSAGE
    ↓
MODEL_REQUEST_STARTED
    ↓
0..N ASSISTANT_DELTA
    ↓
0..N TOOL/REASONING EVENTS
    ↓
ASSISTANT_COMPLETE
```

Failure:

```text
MODEL_REQUEST_STARTED
    ↓
0..N partial events
    ↓
ASSISTANT_ERROR
```

Cancellation:

```text
MODEL_REQUEST_STARTED
    ↓
0..N partial events
    ↓
TURN_CANCELLED
```

Every logical turn needs an identifier.

Example:

```ts
type AssistantDeltaEvent = {
  type: "assistant_delta";
  turnId: string;
  content: string;
};

type AssistantCompleteEvent = {
  type: "assistant_complete";
  turnId: string;
  content: string;
};

type AssistantErrorEvent = {
  type: "assistant_error";
  turnId: string;
  message: string;
  code?: string;
};
```

Exact types should match repository conventions.

Do not blindly copy this example if the project already has suitable identity objects.

---

# 19. Preserve Tool Calls and Reasoning During Stream Repair

Streaming fixes must not regress agent features.

Explicitly test:

```text
plain text answer
reasoning + text
tool call + text
multiple tool calls
tool call with no initial text
tool result followed by model continuation
multiple agent turns
abort while tool is pending
abort while model is streaming
```

A model stream containing only tool-call data is not a blank stream.

Do not trigger erroneous empty-response fallback while a legitimate tool turn is occurring.

---

# 20. Cancellation and Input-State Hardening

Review the TUI state around:

```text
submitting
streaming
running tools
cancel
complete
error
```

Required invariant:

After every terminal state, the composer becomes usable again.

Test:

```text
API 401
API 400
API 429
API 500
DNS/network failure
connection reset
stream parse error
user cancellation
tool failure
successful answer
```

No path should leave the CLI indefinitely stuck in a running/submitting state.

---

# 21. Slash-Command Contract Tests

Add automated registry tests.

For every visible command verify:

1. unique canonical name;
2. no duplicate visible alias;
3. autocomplete entry;
4. help entry;
5. route/handler exists;
6. handler does not throw on basic invocation;
7. no production-visible placeholder unless intentionally marked experimental.

Explicitly assert presence of:

```text
/config
/settings
/yolo
/auto
/plan
/effort
/compact
/new
/sessions
/mcp
/reload
/plugins
/theme
/init
```

Canonical model picker:

```text
/model
```

Alias if retained:

```text
/models
```

should not create a duplicate visible selection.

---

# 22. Config/Command Consistency

There must be one source of truth for command metadata.

Avoid separate manually-maintained arrays for:

```text
autocomplete
help
command dispatch
documentation
```

where they can drift.

Prefer metadata-driven generation.

Likewise, `/settings`, `/config`, `/status`, and runtime behavior should derive from the same config schema.

---

# 23. Config Write Safety

All persistent settings changes should:

```text
read current state
validate input
write temporary file
fsync/close as appropriate
atomically rename
preserve restrictive permissions
re-read
validate persisted state
```

Do not truncate the only config file before validation.

Ensure API-key-containing files remain owner-readable only where supported.

Gracefully account for Windows filesystem semantics.

---

# 24. CI Repair Procedure

Start from a clean install.

```bash
cd "/Users/super_user/Projects/venice-cli"

git status --short
git clean -ndx
```

Do not execute a destructive `git clean` without reviewing the preview.

Then:

```bash
rm -rf node_modules
npm ci
```

Print scripts:

```bash
node - <<'NODE'
const p = require("./package.json");
console.log(JSON.stringify({
  engines: p.engines,
  packageManager: p.packageManager,
  scripts: p.scripts
}, null, 2));
NODE
```

Run the exact quality commands referenced by:

```text
.github/workflows/ci.yml
```

Do not guess script names.

For the current failed Actions run, obtain and preserve logs for:

```text
Run 31988790242
Quality
Node 18 Linux
Node 18 Windows
Node 20 Linux
Node 20 Windows
Node 22 Linux
Node 22 Windows
```

Create a failure ledger:

```text
job
step
command
first error
root/cascade
source file
fix
reproduction command
```

Do not patch every repeated error independently.

---

# 25. Cross-Platform Matrix

The project declares Windows runtime checks, so new functionality must account for Windows.

Review especially:

```text
path separators
HOME vs USERPROFILE
process spawning
shell quoting
external editor invocation
temporary directories
file permissions
atomic rename behavior
ANSI rendering
signal handling
process termination
MCP child processes
```

Avoid shell-string execution such as:

```ts
exec(`${editor} ${path}`)
```

for user-controlled/config-derived paths.

Use argument arrays and appropriate spawning primitives.

---

# 26. Security Review Required During Repair

The new command work adds several high-risk control surfaces:

```text
/settings
/config
/yolo
/plugins
/mcp
/reload
```

Audit for:

### Secret leakage

No API keys in:

```text
transcripts
logs
errors
status views
debug bundles
test snapshots
```

### Command injection

Any external editor, MCP executable, plugin invocation, or shell integration must avoid concatenated shell commands.

### Permission escalation

`/yolo` must be a local explicit user action.

Model output must never change permission mode.

### Untrusted configuration

Invalid MCP/plugin/config files must fail closed without corrupting last-known-good runtime state.

### Debug exports

Redact sensitive data by default.

---

# 27. Recommended Implementation Order

## Phase 0 — Freeze and reproduce

No feature additions yet.

- Record commit SHA.
- Record environment.
- Clean install.
- Reproduce no-output behavior.
- Reproduce CI failures.
- Capture minimal failing test/request cases.
- Verify API key/model separately from TUI where possible.

Deliverable:

```text
docs/audits/live-repair-baseline-2026-08-16/
```

or the repository's established evidence location.

---

## Phase 1 — P0 model-output pipeline

Repair:

```text
VCLI-LIVE-001
VCLI-LIVE-002
VCLI-LIVE-003
VCLI-LIVE-004
```

Order:

1. terminal error event contract;
2. authoritative assistant completion event;
3. turn/message IDs;
4. transcript reconciliation;
5. SSE parser hardening;
6. cancellation state;
7. regression tests.

Do not mix slash-command work into this phase unless necessary for tests.

---

## Phase 2 — CI

Repair:

```text
VCLI-LIVE-005
```

Get the existing declared quality/runtime matrix green.

Do not suppress tests to make the pipeline pass.

If a P0 streaming repair causes CI changes, distinguish newly introduced failures from pre-existing ones.

---

## Phase 3 — Command registry cleanup

Repair:

```text
duplicate /model + /models
unknown slash fallback
alias metadata
registry/help/autocomplete consistency
```

Then add ergonomic runtime aliases:

```text
/auto
/yolo
```

---

## Phase 4 — Config and runtime controls

Implement:

```text
/config
/settings
/effort
/reload
```

Add:

- schema validation;
- atomic writes;
- secret redaction;
- capability-aware reasoning effort;
- last-known-good reload state.

---

## Phase 5 — Media settings

Implement real media safe-mode behavior only after confirming the current Venice API contract.

Do not ship a no-op toggle.

---

## Phase 6 — Extended management surfaces

Implement/complete:

```text
/mcp
/plugins
/theme
```

Do not manufacture fake plugin semantics.

---

## Phase 7 — Exposed stubs and cleanup

Resolve:

```text
/export-debug-zip
```

Then search globally for:

```bash
rg -n \
  'TODO|FIXME|HACK|XXX|not implemented|coming soon|placeholder|throw new Error' \
  src test tests .github
```

Review every hit manually.

Not every TODO is a bug.

Every user-visible unfinished feature is a release concern.

---

# 28. Required Further Audit

While implementing the above, perform a structured second-pass audit over the entire source tree.

At minimum inspect:

```text
src/agent/**
src/ui/**
src/lib/**
src/mcp/**
src/skills/**
src/tools/**
src/session/**
src/config/**
test/**
tests/**
.github/**
package.json
tsconfig*
eslint*
```

Adapt paths to the actual repository layout.

For every issue found record:

```text
ID
severity
status: CONFIRMED / INFERRED / SUSPECTED
source location
reproduction
impact
root cause
recommended fix
test proving resolution
```

Never label an issue CONFIRMED without evidence.

---

# 29. Model/API Verification

Because streaming and model behavior are provider-sensitive, verify against the current official Venice API documentation before modifying request schemas.

Sources of truth:

```text
https://github.com/veniceai/api-docs
https://docs.venice.ai
```

Validate at minimum:

```text
chat endpoint
stream parameter
SSE event format
models endpoint
tool-call streaming
reasoning fields
usage events
finish reasons
model capability metadata
media safety controls
```

Do not infer provider fields from OpenAI compatibility alone when Venice documents behavior explicitly.

---

# 30. Regression Tests Required Before Completion

At minimum create tests proving the following.

## Model responses

```text
normal non-streamed response renders
normal streamed response renders
long streamed response preserves prefix/middle/suffix
final canonical response exactly matches expected content
```

## Failures

```text
401 visible
400 visible
429 visible
500 visible
network failure visible
stream parser failure visible
```

No failure may silently return to the prompt.

## Streaming

```text
arbitrary chunk boundaries
UTF-8 boundaries
LF/CRLF
data:/data: 
[DONE]
EOF residual buffer
tool calls
reasoning
usage-only frames
```

## Slash commands

Every required command is discoverable and locally routed.

## Model picker

Only one visible model-selection command.

## Config

Invalid config cannot replace known-good state.

## Secrets

API key does not appear in:

```text
status
transcript
debug output
debug zip
errors
```

## Permission modes

```text
/auto
/yolo
```

map exactly onto existing runtime-mode semantics.

## Sessions

After:

```text
/new
/sessions
/resume
```

conversation state remains coherent.

Streaming deltas must not result in duplicate assistant history entries after resume.

---

# 31. Manual Acceptance Script

After automated tests pass, perform a real terminal smoke test.

Launch the CLI using the repository's normal local development command.

Run:

```text
/help
/model
/models
/status
/plan
/plan on
/plan off
/compact
/new
/sessions
/mcp
/init
/config
/settings
/effort
/auto
/yolo
/reload
/plugins
/theme
```

Verify:

- no duplicate model picker;
- aliases do not duplicate help/autocomplete;
- no command unexpectedly hits the LLM;
- no visibly exposed stub;
- settings secrets remain masked.

Then submit:

```text
Reply with exactly:
VENICE_STREAM_TEST_OK
```

Verify it appears incrementally and ultimately resolves to the authoritative final assistant message.

Then request a long response large enough to exceed the normal transcript/event limit.

Verify:

```text
beginning present
middle present
ending present
no duplicate text
no missing prefix
```

Then deliberately test invalid credentials.

The UI must display a sanitized useful error instead of returning silently.

Restore valid credentials.

Test cancellation midway through a long stream.

The composer must recover.

---

# 32. CI Completion Gate

Do not declare this work complete until the repository's declared checks are green.

At minimum:

```text
clean dependency install
type checking
lint
unit tests
stream/parser tests
build
runtime matrix
Windows matrix
acceptance tests
```

If the repository supports Node:

```text
18
20
22
```

all declared lanes must pass or the supported-version policy must be intentionally changed with evidence and documentation.

No skipped critical gate should be described as passing.

---

# 33. Definition of Done

This work is complete only when all of the following are true:

- [ ] Successful model calls visibly produce LLM output.
- [ ] Failed model calls visibly produce sanitized errors.
- [ ] No model/API error is swallowed as an ignored successful Promise value.
- [ ] Streaming uses an authoritative terminal completion event.
- [ ] Long streamed messages do not lose their beginning.
- [ ] SSE parsing passes boundary and EOF tests.
- [ ] Tool calls still function during streaming.
- [ ] Cancellation cleanly restores UI state.
- [ ] `/config` is functional.
- [ ] `/settings` is functional.
- [ ] API keys are masked.
- [ ] Media safe mode has real provider-backed behavior, not a no-op toggle.
- [ ] `/yolo` uses the existing permission architecture.
- [ ] `/auto` uses the existing permission architecture.
- [ ] `/plan` remains functional.
- [ ] `/effort` is capability-aware.
- [ ] `/compact` remains functional.
- [ ] `/new` remains functional.
- [ ] `/sessions` remains functional.
- [ ] `/mcp` has a coherent management surface.
- [ ] `/reload` is transactional.
- [ ] `/plugins` corresponds to a real subsystem/product definition.
- [ ] `/theme` uses centralized theme state.
- [ ] `/init` remains functional.
- [ ] Only one visible model-selection entry exists.
- [ ] Unknown slash commands are handled locally.
- [ ] `/export-debug-zip` is either complete or no longer publicly advertised.
- [ ] No secret appears in diagnostics or exported debug material.
- [ ] All declared CI quality gates pass.
- [ ] All declared runtime matrix lanes pass.
- [ ] Documentation and `/help` match the actual command surface.

---

# 34. Do Not

Do not:

- rewrite the entire TUI to fix the streaming bug;
- introduce a second runtime permission system;
- independently reimplement `/plan`, `/compact`, `/new`, `/sessions`, `/mcp`, or `/init`;
- treat `/model` and `/models` as two user-visible features;
- solve CI by deleting failing tests;
- disable Windows checks to make CI green;
- remove supported Node versions without evidence;
- swallow stream/parser/model exceptions;
- use `streamed: true` as proof visible content reached the user;
- persist stream chunks as separate assistant conversation messages;
- let transcript limits operate on transport chunks;
- expose the API key;
- include credentials in debug archives;
- create a fake media safe-mode toggle;
- send unsupported reasoning parameters to models;
- fake a plugin manager over unrelated APIs without defining the product model;
- make `/reload` destructive to the current session;
- activate YOLO from model-generated text;
- use shell-concatenated user/config paths;
- leave production-visible commands returning "not implemented";
- mass-refactor unrelated code while fixing release blockers;
- claim success from static inspection alone.

---

# 35. Final Agent Deliverables

Return all of the following when implementation is complete.

## A. Executive summary

State:

```text
what was broken
root causes
what was changed
what remains
```

## B. Findings ledger

For every `VCLI-LIVE-*` issue include:

```text
severity
status
root cause
files changed
tests added
validation result
```

## C. Additional findings

Any new defects discovered during the whole-repository scan.

Do not silently repair unrelated defects without documenting them.

## D. Streaming evidence

Include evidence for:

```text
successful stream
failed stream
long stream
tool-call stream
cancelled stream
```

## E. Slash-command matrix

Produce:

```text
command
canonical/alias
handler
scope
persistence
tested
```

## F. CI evidence

Report every declared job and final result.

Explicitly include Linux and Windows.

## G. Security review

Confirm:

```text
secret redaction
permission-mode behavior
safe config writes
debug export handling
external command spawning
```

## H. Remaining risks

Clearly separate:

```text
fixed
deferred
blocked
requires maintainer decision
```

Do not call the project complete while P0/P1 blockers remain.

---

# 36. Priority Order

If scope pressure occurs, follow this order without exception:

```text
1. Visible LLM output
2. Error propagation
3. Stream correctness
4. Transcript correctness
5. SSE correctness
6. CI
7. Duplicate model UX
8. Slash-command registry integrity
9. /auto and /yolo
10. /config
11. /settings
12. /effort
13. /reload
14. media safe mode
15. /mcp improvements
16. /plugins
17. /theme
18. debug-export cleanup
19. secondary polish
```

A beautiful command menu is not a substitute for a functioning model-response pipeline.

Restore correctness first.