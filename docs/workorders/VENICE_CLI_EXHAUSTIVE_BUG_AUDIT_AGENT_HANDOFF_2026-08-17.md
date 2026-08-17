# Venice CLI — Exhaustive Bug Audit & Kimi-CLI Parity Agent Handoff

**Repository:** https://github.com/spearchucker667/venice-cli  
**Reviewed branch:** `main`  
**Pinned reviewed commit:** `61fcefa06f8abc46e450bce6ee539edac7169800`  
**Audit date:** 2026-08-17  
**Package observed at reviewed source:** `@spearchucker667/venice-cli` `2.1.0`  
**Primary objective:** stabilize the CLI as a production-grade agent CLI first, then close intentional Kimi-style capability gaps without copying names that do not have equivalent semantics.

---

## 0. Read This First — Scope, Evidence, and Execution Rules

This handoff is written for the implementation agent that will modify the repository.

The review was performed against the live GitHub repository and pinned to the commit above so findings do not drift as `main` moves. The audit traced the critical execution paths line-by-line through the interactive TUI, agent runtime, model streaming, context/compaction, sessions, configuration, permissions, shell execution, MCP, skills, slash handlers, legacy chat path, CI, and publish configuration.

The environment used for this review did **not** provide a local clone/test runner after the repository handoff attempt, so `SOURCE-CONFIRMED` means the defect is established from the pinned source control flow, not that every finding was locally reproduced in this audit session. GitHub Actions independently reports the reviewed `main` run as failed. Do not claim a finding is runtime-reproduced until you run the prescribed test.

Do not use old audit findings blindly. The repository has changed: the reviewed source already contains CI and publish workflows and the package is scoped. Re-verify every item at the pinned commit or the successor commit you actually modify.

### Severity

- **P0 — release blocker / high-impact security or ownership invariant.** Fix before feature work.
- **P1 — major correctness, durability, isolation, or cancellation defect.** Fix in stabilization phases.
- **P2 — important robustness, protocol, UX truthfulness, performance, or parity gap.**
- **P3 — minor/quality/compatibility issue.**

### Finding counts

- **P0:** 3
- **P1:** 21
- **P2:** 35
- **P3:** 3
- **Total:** 62

These counts intentionally include both implementation bugs and explicit Kimi-parity gaps; each finding's category/confidence states which it is.

### Source anchoring

Line numbers move quickly in this repository. Each finding therefore includes:
1. the pinned commit;
2. the exact file(s)/symbol(s);
3. an `rg -n` locator command.

When you begin work, run the locator against the checked-out commit and record exact line numbers in the implementation PR/commit notes.

---

## 1. Required Agent Operating Mode

1. Work from a clean checkout of the intended branch.
2. Before editing, record:
   ```bash
   git status --short
   git rev-parse HEAD
   node --version
   npm --version
   ```
3. If HEAD differs from `61fcefa06f8abc46e450bce6ee539edac7169800`, compare the changed files that overlap this audit. Mark findings `already fixed`, `still present`, or `changed`.
4. Create a safety branch or local checkpoint according to the maintainer's workflow. Do not overwrite unrelated user work.
5. Run the Phase 0 baseline before changing code.
6. Fix invariants before UI/parity work. Do **not** add background tasks, AFK autonomy, richer plugins, or more concurrency while foreground turn ownership/cancellation is unsafe.
7. Add a regression test for every bug fix. A source edit without a failing-before/passing-after test is incomplete unless the behavior cannot reasonably be automated; document that exception.
8. Keep machine-output protocols versioned and stdout clean.
9. Treat persisted session/config paths and shell commands as security boundaries, not convenience helpers.
10. Do not silently repair-and-overwrite corrupt user data.

---

## 2. Phase 0 — Reproduce Current CI Failure First

Current reviewed `main` has a failed GitHub Actions run:

```text
run_id: 32023242246
commit: 61fcefa06f8abc46e450bce6ee539edac7169800
status: completed / failure
```

The available GitHub connector did not expose the exact failed step, so this handoff deliberately does **not** invent it.

Use:

```bash
gh run view 32023242246 --repo spearchucker667/venice-cli --log-failed
gh run view 32023242246 --repo spearchucker667/venice-cli
```

Then run locally:

```bash
npm ci
npm run lint
npm run typecheck
npm run build
npm run test:compiled
npm run test:security
npm run completions:check
npm run api:contract
npm audit --omit=dev
npm run pack:check
npm run verify
```

Do not start parity features until the baseline is green or the exact pre-existing failure is isolated and documented.

---

## 3. Critical Architectural Invariants

All later work must preserve these invariants.

### 3.1 Exactly one foreground turn owner

A foreground turn owns:
- one immutable `AbortController`;
- one `turnId`;
- one active model stream at a time;
- its tool executions;
- its ephemeral attachments;
- its finalization/save boundary.

No UI state change may replace those resources before the turn's `finally` completes.

### 3.2 Durable history and ephemeral turn context are different things

Model context should be assembled as:

```text
canonical system contract
+ global/project instructions
+ compacted durable conversation history
+ path-scoped rules applicable to this operation
+ active-turn attachments
+ active user message
```

Compaction may rewrite only durable history. It must not erase or leak the active turn's attachments.

### 3.3 Persisted paths are untrusted input

Any path loaded from:
- session JSON,
- imported state,
- checkpoint metadata,
- plugin metadata,
- MCP config,
- plan state

must be canonicalized and revalidated at the moment of use. Never delete/write based solely on a serialized absolute path.

### 3.4 `auto` is not `yolo`

`auto` may automate decisions only when a capability is positively known to be safe under a documented policy. A regex that fails to recognize a dangerous raw shell string cannot be the authorization boundary. `yolo` is the explicit user bypass.

### 3.5 Machine modes are protocols

`json`, `stream-json`, and any future ACP/wire mode must have:
- versioned schemas;
- stable correlation IDs;
- exactly defined stdout/stderr behavior;
- exactly one terminal outcome;
- explicit incomplete/cancelled/error states.

---

## 4. Detailed Findings

### VCL-001 — Cancellation swaps the runtime AbortSignal before the cancelled turn has actually unwound

**Severity:** P0  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Turn ownership / cancellation

**Evidence anchor:** `src/ui/app.tsx` (`handleCtrlC`, `abortControllerRef`, `runtime.updateSignal`) and `src/agent/runtime.ts` (`signal`, `updateSignal`, active turn processing).

Locate the current lines:

```bash
rg -n "handleCtrlC|abortControllerRef|updateSignal|this\.signal" src/ui/app.tsx src/agent/runtime.ts
```

**Failure mechanism**

The UI aborts the current controller, immediately creates a replacement controller, and mutates the runtime to point at the replacement signal. The in-flight turn reads a mutable runtime-level signal rather than an immutable per-turn signal. A cancelled turn can therefore observe the new non-aborted signal and continue. The UI can also become ready for another prompt before the prior asynchronous call stack and tool chain has fully terminated.

**Reproduction / proof target**

Instrument or mock a long model stream/tool call. Start turn A, press Ctrl-C, and immediately submit turn B. Assert that no continuation of A can emit model deltas, start tools, write files, or mutate session state after B owns the runtime.

**Required remediation**

Introduce a first-class `TurnExecution`/`TurnController` with an immutable `AbortController`, `turnId`, state, and completion promise. The runtime must never use a replaceable process-global signal for active work. The UI may create the next turn only after the prior turn's `finally` completes. Derive busy state from the runtime state machine rather than a UI boolean.

**Regression tests**

Add cancellation race tests covering model-stream cancellation, tool cancellation, immediate resubmission, and queued-turn handoff.

**Acceptance criteria**

After Ctrl-C, the cancelled turn cannot emit output, launch tools, mutate context, or save additional turn state. A subsequent turn never overlaps it.

---

### VCL-057 — Regex-based shell risk classification is not a safe authorization boundary for auto-approval

**Severity:** P0  
**Confidence:** SOURCE-CONFIRMED SECURITY DESIGN FLAW  
**Category:** Shell authorization

**Evidence anchor:** `src/agent/permissions.ts` destructive/network command classification and auto/yolo decision logic.

Locate the current lines:

```bash
rg -n "destructive|network|shell|regex|auto|yolo|approve|rm |git reset|curl|wget" src/agent/permissions.ts src/tools/shell/execute.ts
```

**Failure mechanism**

Command-string heuristics are necessarily incomplete. Variants/wrappers can perform destructive or external actions without matching narrow patterns (for example recursive removal variants, destructive git operations, interpreters executing network/filesystem code, redirections, platform-specific shells). If `auto` trusts the classifier as a security boundary, a false negative becomes fail-open authorization.

**Reproduction / proof target**

Build a defensive corpus of equivalent destructive/network operations expressed through different shells/interpreters and assert policy classification. Do not rely on a few regex examples as proof of safety.

**Required remediation**

Treat regex classification as UI risk labeling only. For `auto`, authorize only structurally known safe capabilities/tools or use an allowlisted shell command grammar. Unknown/raw shell commands that can mutate or access network must require explicit approval unless the user chose yolo. Keep yolo as the explicit bypass.

**Regression tests**

Large cross-platform adversarial classification corpus; interpreter/wrapper/redirection cases; auto must fail closed on unknown.

**Acceptance criteria**

A classifier false negative cannot silently grant a dangerous raw shell command in auto mode.

---

### VCL-062 — Current reviewed `main` commit has a failing GitHub Actions run

**Severity:** P0  
**Confidence:** GITHUB-ACTIONS-CONFIRMED  
**Category:** CI / release

**Evidence anchor:** GitHub Actions run `32023242246` associated with reviewed SHA. The connector confirmed run status `completed/failure`; exact failing step was not exposed by the available log response and is therefore intentionally not guessed here.

Locate the current lines:

```bash
gh run view 32023242246 --repo spearchucker667/venice-cli --log-failed
```

**Failure mechanism**

A red main branch means the current release baseline is not trustworthy. Feature work can mask or compound the existing regression.

**Reproduction / proof target**

From an authenticated development shell, run the `gh run view` command above and then reproduce the failing gate locally.

**Required remediation**

Make this Phase 0. Identify the exact failed step, reproduce locally, fix the smallest root cause, and rerun the complete `npm run verify` plus workflow matrices before parity work.

**Regression tests**

The existing full CI matrix is the acceptance test; add a regression only for the root cause found.

**Acceptance criteria**

The reviewed branch's replacement commit is green for quality, platform, and runtime matrices before subsequent phases merge.

---

### VCL-002 — AbortSignal is not propagated through Runtime → ModelClient → streaming HTTP request

**Severity:** P1  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Turn ownership / cancellation

**Evidence anchor:** `src/agent/runtime.ts` model completion calls, `src/agent/model-client.ts` completion options, and `src/lib/api.ts` `chatCompletionStream` abort support.

Locate the current lines:

```bash
rg -n "modelClient\.complete|complete\(|abortSignal|chatCompletionStream" src/agent/runtime.ts src/agent/model-client.ts src/lib/api.ts
```

**Failure mechanism**

The HTTP streaming layer supports an abort signal, but the runtime's turn signal is not carried through the model-client option type into the API call. Cancelling the UI/runtime can leave the underlying request alive until timeout/EOF and can permit late deltas.

**Reproduction / proof target**

Mock a streaming endpoint that blocks before headers and another that blocks mid-stream. Cancel the turn in both states and measure whether the fetch/socket aborts promptly.

**Required remediation**

Add `signal: AbortSignal` to the model request contract and compose it with request/idle timeout signals. Do not create an unrelated controller that masks the parent abort.

**Regression tests**

Unit-test signal propagation and integration-test cancellation before headers, during SSE read, and while parsing a tool-call delta.

**Acceptance criteria**

A turn cancellation aborts the network request promptly and deterministically in every model-request phase.

---

### VCL-003 — State-mutating slash commands can execute while a model/tool turn is active

**Severity:** P1  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Turn ownership / slash commands

**Evidence anchor:** `src/ui/slash-commands.ts`, `src/ui/slash-handlers.ts`, and `src/ui/app.tsx` slash dispatch while `isRunning` is true.

Locate the current lines:

```bash
rg -n 'name: "(new|clear|resume|fork|model|plan|permissions|reload|import|delete|theme|skill|compact)"|isRunning|slash' src/ui/slash-commands.ts src/ui/slash-handlers.ts src/ui/app.tsx
```

**Failure mechanism**

Commands that replace session/model/mode/config state are not protected by one central runtime idle gate. `/new`, `/resume`, `/fork`, `/model`, `/plan`, `/permissions`, `/reload`, `/import`, `/delete`, `/theme`, and `/skill` can race active work. `/compact` has special treatment, but the safety model is inconsistent.

**Reproduction / proof target**

Start a slow turn and invoke `/new`, `/resume`, and `/model` before it completes. Observe whether the old turn can append into the new state or use a model/mode that changed mid-turn.

**Required remediation**

Classify commands centrally as `READ_ONLY_ALWAYS`, `INTERRUPT`, `QUEUE_BOUNDARY`, or `IDLE_ONLY_MUTATION`. Enforce the classification before handlers run; handlers must not duplicate ad-hoc busy checks.

**Regression tests**

Table-driven tests for every slash command in idle, streaming, tool-running, cancelling, and failed states.

**Acceptance criteria**

No state-mutating command can change session/model/context/permission state beneath an active turn.

---

### VCL-004 — Direct shell/tool passthrough can bypass the same exclusive turn-ownership boundary

**Severity:** P1  
**Confidence:** STRONG-SOURCE-INFERENCE  
**Category:** Turn ownership / tools

**Evidence anchor:** `src/ui/app.tsx` direct shell mode and `src/agent/runtime.ts` `executeDirectTool` path.

Locate the current lines:

```bash
rg -n "executeDirectTool|shell mode|shellMode|isRunning" src/ui/app.tsx src/agent/runtime.ts
```

**Failure mechanism**

The interactive shell passthrough path can invoke direct tool execution independently of the normal model-turn loop. Without a shared execution mutex, it can overlap an active turn and contend for workspace/process/session resources.

**Reproduction / proof target**

Run a long tool-producing agent turn, enter shell passthrough, and execute a mutating command. Instrument runtime to prove whether both executions coexist.

**Required remediation**

All runtime work that can touch tools/workspace/session state must acquire the same turn-execution lock. If shell passthrough is allowed during a model stream, explicitly queue it at a turn boundary instead of running concurrently.

**Regression tests**

Concurrency tests for agent turn + direct tool, direct tool + `/new`, and cancellation of direct shell work.

**Acceptance criteria**

At most one mutating runtime execution owns the workspace/session at a time unless an explicitly designed background-task subsystem is used.

---

### VCL-005 — Queued or injected `@file` mentions lose their attachment payload

**Severity:** P1  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Context / queued turns

**Evidence anchor:** `src/ui/app.tsx` mention resolution versus queue/inject paths, `src/ui/mentions.ts`, and runtime string-based queued-turn APIs.

Locate the current lines:

```bash
rg -n "readMentionedFiles|mention|inject|queue|queued" src/ui/app.tsx src/ui/mentions.ts src/agent/runtime.ts
```

**Failure mechanism**

The immediate-submit path resolves mentioned file content, but busy-turn queue/injection paths retain primarily text. A prompt queued while another turn is active can arrive without the file bytes/context the user explicitly attached.

**Reproduction / proof target**

Start a slow turn, then queue `review @src/foo.ts`. When the queued turn runs, inspect the model request and assert the file content is present.

**Required remediation**

Replace string queues with a structured immutable `TurnPayload` containing `text`, resolved attachment records, mention references, provenance, and enqueue metadata. Resolve files at the defined semantic point and preserve them across the queue boundary.

**Regression tests**

Queue/inject one and multiple files, files with spaces, deleted-after-enqueue files, and oversized files.

**Acceptance criteria**

A queued prompt has the same attachment semantics as the same prompt submitted while idle.

---

### VCL-006 — Per-turn file context can leak into the next queued turn

**Severity:** P1  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Context / queued turns

**Evidence anchor:** `src/agent/context.ts` file-context state and `src/agent/runtime.ts` queue-draining loop/final cleanup.

Locate the current lines:

```bash
rg -n "fileContext|clearFile|clear.*context|queued|queue" src/agent/context.ts src/agent/runtime.ts
```

**Failure mechanism**

File context is stored on a shared context manager and cleared at a broader execution boundary. If process logic drains more than one queued turn inside that boundary, attachments from turn A can remain visible to turn B.

**Reproduction / proof target**

Turn A references a uniquely identifiable secret marker in an attached file. Queue turn B without attachments. Capture B's outbound model messages and verify that marker is absent.

**Required remediation**

Make attachments ephemeral fields of `TurnPayload`/`TurnExecution`; construct the model context from history + only the active turn's payload. Never persist attachment bytes as ambient mutable runtime state.

**Regression tests**

Cross-turn leakage tests, including cancellation and auto-compaction between queued turns.

**Acceptance criteria**

No attachment enters a turn unless that turn explicitly owns it.

---

### VCL-007 — Auto-compaction can erase the current turn's file context before the model request

**Severity:** P1  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Context / compaction

**Evidence anchor:** `src/agent/runtime.ts` compaction ordering and `src/agent/context.ts` compact/file-context behavior.

Locate the current lines:

```bash
rg -n "shouldCompact|compact\(|fileContext|clear" src/agent/runtime.ts src/agent/context.ts
```

**Failure mechanism**

The runtime may decide to compact after current attachment context has been loaded. Compaction clears/rebuilds context and can remove the just-added file material before the actual request.

**Reproduction / proof target**

Create history close to the compaction threshold, attach `@file` with a unique marker, submit, and inspect the post-compaction outbound messages.

**Required remediation**

Compaction must operate on durable conversation history, not the ephemeral current-turn payload. Rebuild context as `compactedHistory + activeTurnAttachments + activeUserMessage` after compaction.

**Regression tests**

Threshold-edge tests for one/multiple attachments, queued attachments, resumed sessions, and failed compaction.

**Acceptance criteria**

Compaction cannot change the semantic content of the current user turn.

---

### VCL-008 — Resumed sessions can retain a cached model profile while the new ContextManager remains at a zero-token limit

**Severity:** P1  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Context / resume

**Evidence anchor:** `src/agent/context.ts` default token limit, `src/agent/runtime.ts` `loadState`, `setModelProfile`, and cached `refreshModelProfile` path.

Locate the current lines:

```bash
rg -n "maxTokens|modelProfile|loadState|setModelProfile|refreshModelProfile|shouldCompact" src/agent/context.ts src/agent/runtime.ts
```

**Failure mechanism**

A fresh context manager starts with a zero limit. Session load restores `state.modelProfile`, but the profile is not necessarily re-applied to the context manager. A cached-profile early return can then skip the setter. With a zero budget, compaction eligibility becomes pathological and can trigger immediately.

**Reproduction / proof target**

Persist a session with a valid model profile, restart, resume it, and inspect context limit before the first model call. Add an `@file` to expose the compaction interaction.

**Required remediation**

Make model-profile application an invariant: loading/restoring/caching a profile must always update ContextManager. Treat `<= 0` as `unknown/unbounded-for-compaction`, never as a valid zero budget.

**Regression tests**

Cold resume, cached resume, profile-fetch failure, model switch, and near-budget resume.

**Acceptance criteria**

A resumed session uses the same valid context budget it had before restart; zero/unknown never triggers destructive compaction.

---

### VCL-009 — Unknown/failed model-profile discovery can fail open to agent/tool mode

**Severity:** P1  
**Confidence:** STRONG-SOURCE-INFERENCE  
**Category:** Model capability gating

**Evidence anchor:** `src/agent/runtime.ts` model switching/profile refresh and agent-mode reset logic.

Locate the current lines:

```bash
rg -n "setModel|agentMode|supports.*tool|tool.*support|modelProfile|refreshModelProfile" src/agent/runtime.ts src/agent/model-client.ts
```

**Failure mechanism**

Changing model resets/retains agent behavior before capability discovery is guaranteed. If profile lookup fails, a model whose tool support is unknown can still reach a tool-enabled path.

**Reproduction / proof target**

Mock model-profile lookup failure for a model not known to support tools, switch to it, and inspect tools sent in the next request.

**Required remediation**

Tool enablement must be positive-capability gated. Unknown profile => safe chat-only capability until verified. Separate user-desired mode from effective model capability.

**Regression tests**

Profile success/failure/timeout and switch-back cases.

**Acceptance criteria**

No tools are advertised or executable for a model unless capability support is positively established.

---

### VCL-010 — Turn/step budget exhaustion is reported as `complete` instead of incomplete/limit-reached

**Severity:** P1  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Agent loop semantics

**Evidence anchor:** `src/agent/runtime.ts` max-turn/max-step termination path and final status emission.

Locate the current lines:

```bash
rg -n "maxTurns|max.*turn|max.*step|complete|limit" src/agent/runtime.ts src/agent/events.ts
```

**Failure mechanism**

Hitting the loop ceiling appends an explanatory note but resolves with a completion-like status. Automation/headless callers can treat an unfinished task as success.

**Reproduction / proof target**

Set a tiny turn/step ceiling and force a tool-use loop that cannot finish within it. Inspect return status and process/machine output.

**Required remediation**

Define terminal states such as `completed`, `cancelled`, `failed`, `limit_reached`, and `incomplete`. Headless mode should expose them structurally and choose documented exit codes.

**Regression tests**

Budget exhaustion before any tool, after a tool, after partial answer, and after retry exhaustion.

**Acceptance criteria**

Consumers can distinguish successful completion from a budget-constrained stop without parsing prose.

---

### VCL-011 — `venice chat --continue` can resume without the previous assistant answer

**Severity:** P1  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Legacy chat persistence

**Evidence anchor:** `src/commands/chat.ts` streaming and non-streaming success paths around final output and `addConversation()`.

Locate the current lines:

```bash
rg -n "addConversation|messages\.push|assistant|--continue|continue" src/commands/chat.ts
```

**Failure mechanism**

The final assistant text is printed, but the mutable request-history collection is persisted without consistently appending the assistant message first. The next `--continue` call can therefore see the user's prior prompt without the answer the user actually received.

**Reproduction / proof target**

Run `venice chat` with persistence, obtain a known answer, then run `venice chat --continue` and inspect the outgoing history.

**Required remediation**

Create one canonical finalized assistant message from either stream or non-stream response, append it exactly once, then persist. Persist only after successful finalization; define failure/cancellation semantics explicitly.

**Regression tests**

Two-turn continuation for streaming and non-streaming, empty response, cancellation, tool call, and error.

**Acceptance criteria**

Persisted history is semantically identical to the transcript presented to the user.

---

### VCL-012 — Resume can overwrite explicit startup CLI overrides

**Severity:** P1  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Session resume / CLI precedence

**Evidence anchor:** `src/commands/agent.ts` runtime construction and resume options plus `src/agent/runtime.ts` `loadState` restoration.

Locate the current lines:

```bash
rg -n "resume|loadState|--model|--mode|add-dir|additionalWorkspace|permission" src/commands/agent.ts src/agent/runtime.ts
```

**Failure mechanism**

The runtime is created with CLI-selected model/mode/additional roots, then session state restoration can replace model, operating mode, roots, and agent metadata. This makes CLI flags unreliable on resume and differs from normal override expectations.

**Reproduction / proof target**

Create a session with model A/mode A/root A. Resume with explicit model B/mode B/`--add-dir B`; inspect effective runtime state.

**Required remediation**

Define and encode a `ResumeOverrides` precedence contract. Recommended order: explicit invocation flags > session state > config defaults. Apply all overrides after validating/migrating restored state.

**Regression tests**

Cartesian tests for omitted versus explicit model/mode/plan/permission/add-dir flags.

**Acceptance criteria**

Every documented CLI override has deterministic behavior on new and resumed sessions.

---

### VCL-013 — `--interactive` can conflict with machine output modes and start the TUI

**Severity:** P1  
**Confidence:** SOURCE-CONFIRMED  
**Category:** CLI mode selection

**Evidence anchor:** `src/commands/agent.ts` interactive-resolution and output-format selection.

Locate the current lines:

```bash
rg -n "resolveInteractive|interactive|output-format|stream-json|json" src/commands/agent.ts
```

**Failure mechanism**

Explicit interactive selection is resolved before/independently of machine-output constraints. A call such as `--interactive --output-format stream-json` can choose a TUI path that corrupts machine-readable expectations.

**Reproduction / proof target**

Run each machine output mode combined with `--interactive` and pipe stdout to a strict JSON/JSONL parser.

**Required remediation**

Reject contradictory combinations at argument validation, or make machine formats unconditionally headless. Keep diagnostics on stderr.

**Regression tests**

CLI matrix for interactive/headless/stdin/output-format combinations.

**Acceptance criteria**

Machine-output stdout is always parseable and never contains TUI control sequences.

---

### VCL-017 — Nested path-scoped rules are loaded globally instead of only for matching paths

**Severity:** P1  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Prompt architecture / scoped rules

**Evidence anchor:** `src/agent/instructions.ts` tracks scope and exposes `instructionsForPath()`, while runtime prompt assembly uses the broad instruction text; path-specific resolver is not integrated into tool/model context where needed.

Locate the current lines:

```bash
rg -n "instructionsForPath|readNestedRules|scope|instructions\.text|loadInstructions" src/agent/instructions.ts src/agent/runtime.ts
```

**Failure mechanism**

Rules intended only for a subdirectory can influence unrelated files and tools. In a monorepo, one package's constraints can leak into another package's work.

**Reproduction / proof target**

Create contradictory nested rules in `packages/a` and `packages/b`, then ask the agent to edit only B. Capture the prompt/tool context.

**Required remediation**

Separate global instructions from scoped rule objects. Resolve scoped rules at file/tool planning time or inject only rules applicable to paths in the current operation.

**Regression tests**

Root/subdir/sibling/nested precedence and symlink/canonical-path cases.

**Acceptance criteria**

A nested rule affects only paths within its declared canonical scope.

---

### VCL-037 — Session deletion is not scoped to the current workspace

**Severity:** P1  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Session isolation

**Evidence anchor:** `src/agent/sessions.ts` `delete(sessionId)` and `/delete` usage in `src/ui/slash-handlers.ts`.

Locate the current lines:

```bash
rg -n "delete\(sessionId|deleteSession|session.*delete|workspace" src/agent/sessions.ts src/ui/slash-handlers.ts
```

**Failure mechanism**

The manager validates the session ID and deletes its global session directory without requiring the expected workspace. A session ID from workspace B can be deleted while operating in workspace A.

**Reproduction / proof target**

Create sessions in two workspaces, obtain B's ID, then invoke deletion from A.

**Required remediation**

Require `expectedWorkspace` (canonical ID/path) for normal deletion and verify stored metadata before removal. Provide a deliberately named global/admin deletion only if needed.

**Regression tests**

Cross-workspace delete denial, symlinked workspace, corrupt metadata, imported session.

**Acceptance criteria**

Normal workspace-scoped UI cannot delete another workspace's session.

---

### VCL-040 — Plan deletion trusts a persisted plan file path

**Severity:** P1  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Persistence security

**Evidence anchor:** `src/agent/runtime.ts`/plan cleanup path such as `clearPlan()` removing `state.plan.filePath`.

Locate the current lines:

```bash
rg -n "clearPlan|plan\.filePath|rmSync|unlink" src/agent/runtime.ts src/agent
```

**Failure mechanism**

A tampered/imported session can supply an arbitrary absolute path; cleanup can delete outside the allowed plan/workspace root.

**Reproduction / proof target**

Create/import a session whose plan `filePath` points to a harmless temp file outside the plan root, then clear the plan in a controlled test.

**Required remediation**

Never trust persisted absolute deletion targets. Store a plan ID/relative name, derive the canonical path under a fixed plan root at runtime, and validate realpath/parent boundaries before deletion.

**Regression tests**

Absolute path, `..`, symlink, non-existent parent, and valid plan deletion.

**Acceptance criteria**

Plan cleanup cannot remove anything outside the canonical plan storage root.

---

### VCL-041 — Checkpoint restore can bypass workspace realpath/symlink safety

**Severity:** P1  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Filesystem security

**Evidence anchor:** `src/agent/checkpoints.ts` restore write path versus `src/agent/workspace.ts` canonical/symlink-aware resolution.

Locate the current lines:

```bash
rg -n "restore|writeFile|resolve|realpath|symlink|workspace" src/agent/checkpoints.ts src/agent/workspace.ts
```

**Failure mechanism**

Checkpoint restoration constructs/restores paths without consistently routing every write through the workspace manager's realpath-aware boundary checks. A directory can be replaced by a symlink after checkpoint creation and before restore.

**Reproduction / proof target**

Checkpoint `dir/file`, replace `dir` with a symlink to an external temp directory, then restore in a security test.

**Required remediation**

Route every restore target through a single workspace-safe write resolver that validates canonical parent/target immediately before the write. Refuse symlink traversal unless explicitly supported with safe semantics.

**Regression tests**

Symlink swap/TOCTOU, nested symlink, deleted parent, normal restore.

**Acceptance criteria**

Checkpoint restore cannot create/overwrite a file outside approved workspace roots.

---

### VCL-042 — Malformed config is silently converted to `{}` and can then be overwritten by a config mutation

**Severity:** P1  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Configuration durability

**Evidence anchor:** `src/lib/config.ts` `loadConfig()` parse catch/fallback and mutation/save path used by config commands.

Locate the current lines:

```bash
rg -n "loadConfig|JSON\.parse|catch|return \\{\\}|saveConfig|setConfig" src/lib/config.ts src/commands/config.ts
```

**Failure mechanism**

A corrupt `~/.venice/config.json` becomes an in-memory empty object. A later `config set` can save that object plus one field over the original file, erasing API/auth/settings data. This contradicts a fail-visible configuration model.

**Reproduction / proof target**

Back up config, write malformed JSON, run a harmless `config set`, and inspect whether the malformed original is preserved.

**Required remediation**

Split tolerant read-for-display from strict read-for-mutation. Mutation must fail on parse error, create a timestamped backup/quarantine, and use atomic temp-write+fsync+rename only after successful validation.

**Regression tests**

Malformed JSON, permission error, interrupted write, schema-invalid JSON, backup recovery.

**Acceptance criteria**

No config mutation can overwrite an unreadable/corrupt source without explicit recovery.

---

### VCL-045 — MCP server entries are not deeply schema-validated before manager/client use

**Severity:** P1  
**Confidence:** SOURCE-CONFIRMED  
**Category:** MCP robustness

**Evidence anchor:** `src/mcp/config.ts` object-level validation/casting and `src/mcp/manager.ts` field access.

Locate the current lines:

```bash
rg -n "mcpServers|as .*MCP|validate|command|url|transport" src/mcp/config.ts src/mcp/manager.ts src/mcp/client.ts
```

**Failure mechanism**

A null/string/missing-field server entry can survive broad object validation and fail later during startup, potentially degrading all MCP initialization.

**Reproduction / proof target**

Set entries to `null`, string, `{}`, malformed stdio command, and malformed URL.

**Required remediation**

Use a discriminated strict schema per transport. Validate each server independently and isolate/report invalid entries without crashing unrelated servers.

**Regression tests**

Schema table for all valid/invalid transports and partial server failure.

**Acceptance criteria**

Invalid MCP configuration produces actionable per-server diagnostics and cannot crash the whole manager.

---

### VCL-049 — Unexpected SSE EOF/truncation can be accepted as a successful completed response

**Severity:** P1  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Streaming correctness

**Evidence anchor:** `src/lib/api.ts` `chatCompletionStream` read loop/final `done` behavior and `src/agent/model-client.ts` finish-reason defaults.

Locate the current lines:

```bash
rg -n "chatCompletionStream|\\[DONE\\]|done: true|finishReason|reader\.read|done\\)" src/lib/api.ts src/agent/model-client.ts
```

**Failure mechanism**

After the reader loop ends, the stream path can emit a terminal success even when no protocol completion marker/finish reason was observed. A proxy/network truncation can become a partial or empty 'successful' model answer.

**Reproduction / proof target**

Mock an SSE response that sends a few deltas and closes without `[DONE]`/valid completion signal.

**Required remediation**

Track clean protocol completion explicitly. Unexpected EOF before a valid terminal event must throw `STREAM_TRUNCATED`. Retry only when safe and only before any externally visible/stateful side effect that would be duplicated.

**Regression tests**

Clean `[DONE]`, finish reason, empty EOF, partial JSON EOF, partial text EOF, abort, idle timeout.

**Acceptance criteria**

Transport truncation can never be reported as a successful model completion.

---

### VCL-056 — Nested function argument counting in the math parser can associate commas with the wrong function frame

**Severity:** P1  
**Confidence:** STRONG-SOURCE-INFERENCE  
**Category:** Built-in tools / math

**Evidence anchor:** Math-expression parser in `src/lib/tools.ts`, operator/function stack comma handling.

Locate the current lines:

```bash
rg -n "comma|argCount|function|opStack|min|max|math" src/lib/tools.ts
```

**Failure mechanism**

Comma handling searches function markers in the operator stack rather than maintaining an unambiguous nearest-call frame. Nested calls can increment the outer call's argument count instead of the inner call.

**Reproduction / proof target**

Add exact tests such as `max(1,min(2,3))`, `min(max(1,2),3)`, and deeper nesting with 3+ args.

**Required remediation**

Use an AST/parser with explicit call frames or maintain a dedicated function-call frame stack tied to parenthesis depth.

**Regression tests**

Property/fuzz tests for nested functions, unary operators, commas, invalid arity, and parentheses.

**Acceptance criteria**

Nested function expressions evaluate correctly or fail with precise syntax/arity errors.

---

### VCL-058 — Shell subprocess execution does not consistently honor the runtime tool AbortSignal

**Severity:** P1  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Shell cancellation

**Evidence anchor:** Runtime tool context signal and `src/tools/shell/execute.ts` timeout/process handling.

Locate the current lines:

```bash
rg -n "signal|AbortSignal|spawn|exec|timeout|kill" src/agent/runtime.ts src/tools/shell/execute.ts
```

**Failure mechanism**

Ctrl-C may cancel the turn state but leave a shell child/process tree running until its own timeout or natural exit, allowing post-cancel writes.

**Reproduction / proof target**

Run a shell command that spawns a long-lived child which writes periodically. Cancel the turn and verify both parent and child stop.

**Required remediation**

Wire `context.signal` into shell execution. On abort, terminate the process group/tree with platform-specific escalation and idempotent cleanup. Distinguish cancelled from timed out.

**Regression tests**

POSIX child tree, Windows child tree where CI allows, already-exited process, double abort, timeout+abort race.

**Acceptance criteria**

Cancelled shell work cannot continue producing side effects after cancellation completion.

---

### VCL-014 — Agent headless stdin does not use the bounded-input protection present in legacy chat

**Severity:** P2  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Input robustness

**Evidence anchor:** `src/commands/agent.ts` stdin intake versus `src/commands/chat.ts` bounded stdin logic.

Locate the current lines:

```bash
rg -n "stdin|max.*stdin|1.*MiB|read.*stdin|process\.stdin" src/commands/agent.ts src/commands/chat.ts
```

**Failure mechanism**

A caller can pipe arbitrarily large input into the agent path and cause excessive memory/context use, while the legacy chat command already has a size guard.

**Reproduction / proof target**

Pipe multi-megabyte/gigabyte generated input and observe memory and rejection behavior.

**Required remediation**

Use one bounded streaming stdin reader with a configurable documented cap. Stop reading once exceeded and return a specific error.

**Regression tests**

Below/equal/above cap, UTF-8 boundary, pipe close, and no-stdin cases.

**Acceptance criteria**

All commands enforce consistent, explicit stdin limits.

---

### VCL-015 — Mutually exclusive auto/yolo validation does not fully normalize equivalent approval-mode forms

**Severity:** P2  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Permission CLI

**Evidence anchor:** `src/commands/agent.ts` `--auto`, `--yolo`, and approval/permission normalization.

Locate the current lines:

```bash
rg -n "auto|yolo|approval|permission" src/commands/agent.ts
```

**Failure mechanism**

Validation focuses on flag combinations but equivalent mode selection can enter through another option representation. Contradictory invocation state can survive parsing and be resolved implicitly later.

**Reproduction / proof target**

Exercise `--auto`, `--yolo`, and any `--approval/--permission` aliases in all conflicting pairs.

**Required remediation**

Normalize all permission-mode sources into one enum first, then reject multiple explicit conflicting sources before runtime creation.

**Regression tests**

Table-driven parser tests.

**Acceptance criteria**

Exactly one effective permission mode exists and contradictory user intent fails fast.

---

### VCL-016 — Built-in agent contract is represented in more than one prompt layer

**Severity:** P2  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Prompt architecture

**Evidence anchor:** `src/agent/context.ts` default system contract and `src/agent/instructions.ts` `BUILT_IN_AGENT_CONTRACT` composition.

Locate the current lines:

```bash
rg -n "BUILT_IN_AGENT_CONTRACT|system.*contract|default.*system|instructions" src/agent/context.ts src/agent/instructions.ts
```

**Failure mechanism**

Duplicated first-party contracts increase token cost and allow wording/order drift. A rule may appear both as system framing and as project-instruction text with different precedence.

**Reproduction / proof target**

Capture a first-turn model request in a clean workspace and inspect repeated contract clauses.

**Required remediation**

Maintain one canonical immutable system contract. Add project/user/nested instructions as clearly delimited lower layers. Snapshot the assembled prompt.

**Regression tests**

Golden prompt assembly tests for clean, project-rules, nested-rules, resumed, and plugin/skill cases.

**Acceptance criteria**

Each first-party instruction appears once at its intended precedence.

---

### VCL-018 — `/reload` claims broader reload behavior than it implements

**Severity:** P2  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Slash command accuracy

**Evidence anchor:** `src/ui/slash-commands.ts` metadata and `src/ui/slash-handlers.ts` reload handler.

Locate the current lines:

```bash
rg -n 'name: "reload"|reload|discoverSkills|config' src/ui/slash-commands.ts src/ui/slash-handlers.ts
```

**Failure mechanism**

The command description/user feedback implies configuration/extension reload, but the handler primarily re-discovers skills. The UI can tell the user that configuration is refreshed when runtime state was not.

**Reproduction / proof target**

Change config/model/MCP settings on disk, run `/reload`, and inspect effective runtime values.

**Required remediation**

Either implement a transactional reload of supported config, skills, MCP, theme, and rule state, or rename/reword the command to the exact scope (`/reload-skills`).

**Regression tests**

Change-on-disk integration tests per reloaded subsystem.

**Acceptance criteria**

User-visible text exactly matches what runtime state changed.

---

### VCL-019 — `/config` is presented as a configuration hub but is effectively an inspector

**Severity:** P2  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Slash command parity

**Evidence anchor:** `src/ui/slash-commands.ts` description and `src/ui/slash-handlers.ts` config handler.

Locate the current lines:

```bash
rg -n 'name: "config"|config hub|config' src/ui/slash-commands.ts src/ui/slash-handlers.ts
```

**Failure mechanism**

The command surfaces paths/state but does not provide the settings-management UX implied by the intended Kimi-like CLI requirement.

**Reproduction / proof target**

Invoke `/config` and attempt to change model system prompts, rules, or config values without exiting to another command.

**Required remediation**

Implement real config subcommands/menu (`show`, `edit`, `set`, `rules`, `prompts`, `paths`, `validate`) or describe it honestly as `/config show`.

**Regression tests**

Config read/write/reload/validation tests and TUI interaction snapshots.

**Acceptance criteria**

Every advertised configuration action is executable and persists atomically.

---

### VCL-020 — `/plugins` is not a plugin manager; it reports skills/MCP-like extension state

**Severity:** P2  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Extension parity

**Evidence anchor:** `src/ui/slash-commands.ts`, `src/ui/slash-handlers.ts`, and repository search showing no first-class plugin manifest/install lifecycle equivalent.

Locate the current lines:

```bash
rg -n 'name: "plugins"|plugin|plugin\.json|skills|mcp' src
```

**Failure mechanism**

The command name implies executable plugin installation/management, while the current implementation conflates other extension types. This creates false parity with Kimi.

**Reproduction / proof target**

Try to install/list/info/remove a plugin manifest through Venice.

**Required remediation**

Either build a real plugin subsystem with manifest schema, installation provenance, enable/disable, tools/skills hooks, and safe uninstall; or rename the surface to `/extensions` until plugins exist.

**Regression tests**

Manifest validation, local install, archive install, remove, conflict, malicious path traversal, disabled plugin, and tool registration.

**Acceptance criteria**

`plugins` has one documented semantic model; no skills/MCP-only output is mislabeled as plugin management.

---

### VCL-021 — `/mcp` is inspection-oriented and lacks core lifecycle management

**Severity:** P2  
**Confidence:** SOURCE-CONFIRMED  
**Category:** MCP UX parity

**Evidence anchor:** `src/ui/slash-handlers.ts` MCP handler and `src/mcp/*` manager/config APIs.

Locate the current lines:

```bash
rg -n 'name: "mcp"|mcp|restart|enable|disable|remove|add' src/ui/slash-handlers.ts src/mcp
```

**Failure mechanism**

The TUI can show MCP state, but user-facing add/remove/enable/disable/restart/reload flows are incomplete compared with a full agent CLI.

**Reproduction / proof target**

Attempt to add a server, disable a failing server, restart it, and persist the change from the running TUI.

**Required remediation**

Implement `/mcp list|add|remove|enable|disable|restart|reload|doctor`, with schema validation and atomic config persistence.

**Regression tests**

Lifecycle actions for stdio and network servers, invalid config, crash/restart, and duplicate names.

**Acceptance criteria**

A user can manage MCP lifecycle without manually editing JSON and restarting the CLI.

---

### VCL-022 — Skill invocation syntax/arguments do not match current Kimi semantics

**Severity:** P2  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Skills parity

**Evidence anchor:** `src/ui/slash-handlers.ts` `/skill` parsing versus Kimi `/skill:<name> [task]` semantics.

Locate the current lines:

```bash
rg -n 'name: "skill"|/skill|skillName|args' src/ui/slash-commands.ts src/ui/slash-handlers.ts src/skills/registry.ts
```

**Failure mechanism**

Venice uses a `/skill name` style and does not cleanly separate the skill identifier from optional trailing task text. Current Kimi supports `/skill:<name>` plus additional task text.

**Reproduction / proof target**

Try `/skill:git-commits fix login race` and compare with `/skill git-commits fix login race`.

**Required remediation**

Support canonical `/skill:<name> [task]` and optionally keep `/skill <name> [task]` as a compatibility alias. Parse the identifier independently of task arguments.

**Regression tests**

No args, quoted args, Unicode, unknown skill, name collision, and autocomplete.

**Acceptance criteria**

Kimi-style skill invocation works predictably and trailing task text reaches the skill prompt.

---

### VCL-023 — Skill precedence is inverted relative to the intended Kimi target

**Severity:** P2  
**Confidence:** SOURCE-CONFIRMED + OFFICIAL-KIMI-DOC  
**Category:** Skills parity

**Evidence anchor:** `src/skills/registry.ts` discovery order and `Map.set()` collision behavior. Current Kimi precedence is Project > User > Extra > Built-in.

Locate the current lines:

```bash
rg -n "global|project|extra|Map|set\(|discover" src/skills/registry.ts
```

**Failure mechanism**

Venice discovers global/project/extra roots in an order where later map writes can make extra roots override project roots. That conflicts with the more-specific-project-wins target and can silently load the wrong same-name skill.

**Reproduction / proof target**

Define `foo` in project, global/user, and extra roots with distinct markers; inspect which definition wins.

**Required remediation**

Encode scope as data and sort/resolve with an explicit comparator, not incidental loop order. Emit collision diagnostics in verbose/doctor output.

**Regression tests**

Every pairwise scope collision plus same-root duplicate cases.

**Acceptance criteria**

Project overrides user/global, user overrides extra, extra overrides built-in, consistently and observably.

---

### VCL-024 — Skill discovery supports only canonical subdirectory `SKILL.md`, not flat Markdown skills

**Severity:** P2  
**Confidence:** SOURCE-CONFIRMED + OFFICIAL-KIMI-DOC  
**Category:** Skills parity

**Evidence anchor:** `src/skills/registry.ts` filesystem discovery versus current Kimi flat-`.md` support.

Locate the current lines:

```bash
rg -n "SKILL\.md|readdir|\.md|skill" src/skills/registry.ts
```

**Failure mechanism**

Collections containing `foo.md` directly under a skills root are ignored even though current Kimi treats them as skills.

**Reproduction / proof target**

Place `~/.config/venice/skills/demo.md` and run skill discovery.

**Required remediation**

Support both `<name>/SKILL.md` and `<name>.md`. Define same-name conflict precedence, frontmatter/name validation, descriptions, and symlink policy.

**Regression tests**

Flat/canonical duplicates, malformed frontmatter, hidden files, symlinks, and names.

**Acceptance criteria**

Both layouts are discovered with deterministic collision rules.

---

### VCL-025 — Global skill directory is described with inconsistent paths

**Severity:** P2  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Path consistency

**Evidence anchor:** `src/skills/registry.ts`, `/config`/`/plugins` output in `src/ui/slash-handlers.ts`, and `AGENTS.md`.

Locate the current lines:

```bash
rg -n "\.config/venice/skills|\.venice/skills|skillsDir|skills" src/skills/registry.ts src/ui/slash-handlers.ts AGENTS.md
```

**Failure mechanism**

Runtime discovery and user-facing help can point at different directories (`~/.config/venice/skills` versus `~/.venice/skills`), producing 'installed but not found' behavior.

**Reproduction / proof target**

Follow each displayed/documented path and verify which one is actually loaded.

**Required remediation**

Create one path-constants module, choose a canonical location, support a migration/compatibility warning if needed, and update docs/completions.

**Regression tests**

Default home, overridden home, migration, both paths present.

**Acceptance criteria**

Runtime, TUI, docs, doctor, and tests agree on one canonical path.

---

### VCL-026 — No distinct AFK mode

**Severity:** P2  
**Confidence:** PARITY-GAP  
**Category:** Kimi parity

**Evidence anchor:** Venice permission modes expose auto/yolo concepts; current Kimi documents AFK as no-user-present behavior that implies auto-approval but has separate semantics.

Locate the current lines:

```bash
rg -n "afk|auto|yolo|permission" src package.json README.md
```

**Failure mechanism**

Unattended execution is not modeled separately from unconditional approval. That conflates 'nobody can answer a prompt' with 'bypass all authorization decisions'.

**Reproduction / proof target**

Search CLI help and runtime permission state for AFK semantics.

**Required remediation**

Add an explicit AFK invocation/runtime overlay with clear unanswered-question behavior, non-interactive fallbacks, notification policy, and permission semantics. Do not silently equate AFK with yolo.

**Regression tests**

AFK + prompt-required tool, AFK + denied policy, resumed session, print mode.

**Acceptance criteria**

Unattended operation has documented deterministic behavior independent of raw yolo.

---

### VCL-027 — No `/btw`-style isolated side-question path

**Severity:** P2  
**Confidence:** PARITY-GAP  
**Category:** Kimi parity

**Evidence anchor:** No corresponding isolated side-query command found in the reviewed slash registry/runtime.

Locate the current lines:

```bash
rg -n 'btw|side.?question|side.?query' src
```

**Failure mechanism**

Users cannot ask a quick question without perturbing the main conversation/task context, a useful Kimi interaction pattern.

**Reproduction / proof target**

Search slash help and attempt a side query during a long task.

**Required remediation**

Implement side queries using a snapshot/read-only context view that does not append to durable main history unless explicitly promoted.

**Regression tests**

Side query during idle/active turn, cancellation, attachment access, no-history-mutation assertion.

**Acceptance criteria**

A side query returns an answer while leaving the primary task history semantically unchanged.

---

### VCL-028 — No first-class background task subsystem or `/task` lifecycle

**Severity:** P2  
**Confidence:** PARITY-GAP  
**Category:** Kimi parity

**Evidence anchor:** No durable background task registry/lifecycle command comparable to current Kimi interaction features.

Locate the current lines:

```bash
rg -n 'background.?task|/task|task list|task cancel|task status' src
```

**Failure mechanism**

Long-running auxiliary work cannot be intentionally detached, inspected, cancelled, or rejoined. Ad-hoc concurrency would worsen the existing turn-ownership defects.

**Reproduction / proof target**

Attempt to launch a background shell/research task and inspect it later.

**Required remediation**

Only after VCL-001..004, add a separate background-task manager with task IDs, ownership, bounded concurrency, output buffering, cancellation, persisted metadata, and workspace permission policy.

**Regression tests**

Launch/list/status/cancel/restart cleanup, process exit, session switch, workspace isolation.

**Acceptance criteria**

Background work is explicit, observable, cancellable, and never masquerades as concurrent foreground turns.

---

### VCL-029 — Additional workspace roots are startup-only; no runtime `/add-dir` parity

**Severity:** P2  
**Confidence:** PARITY-GAP  
**Category:** Kimi parity

**Evidence anchor:** `src/commands/agent.ts` `--add-dir` and absence of a slash lifecycle equivalent.

Locate the current lines:

```bash
rg -n "add-dir|additionalWorkspace|workspaceRoots" src
```

**Failure mechanism**

A user must restart/recreate runtime state to grant another workspace root.

**Reproduction / proof target**

Start TUI and try to add a directory to allowed roots without restart.

**Required remediation**

Add `/add-dir <path>` and optionally `/remove-dir`, canonicalize paths, re-evaluate permissions, persist only by explicit policy, and surface effective roots.

**Regression tests**

Relative/absolute/symlink/nonexistent/duplicate/root-removal cases.

**Acceptance criteria**

Runtime root changes are canonical, permission-aware, and visible.

---

### VCL-030 — No explicit thinking on/off control separate from reasoning effort

**Severity:** P2  
**Confidence:** PARITY-GAP  
**Category:** Kimi parity

**Evidence anchor:** Venice exposes effort-like controls; current Kimi supports `--thinking` / `--no-thinking` separately.

Locate the current lines:

```bash
rg -n "thinking|reasoningEffort|effort" src
```

**Failure mechanism**

Model thinking capability and reasoning intensity are conflated or not directly controllable, making behavior/model compatibility less predictable.

**Reproduction / proof target**

Inspect CLI help/slash commands for an independent thinking toggle.

**Required remediation**

Represent `thinkingEnabled: boolean | undefined` separately from effort. Capability-gate it and preserve/resume according to documented precedence.

**Regression tests**

Supported/unsupported models, new/resumed sessions, explicit CLI override.

**Acceptance criteria**

Users can enable/disable thinking independently of effort where supported.

---

### VCL-031 — Missing Kimi-compatible print/quiet/ACP/wire execution modes

**Severity:** P2  
**Confidence:** PARITY-GAP  
**Category:** Kimi parity / automation

**Evidence anchor:** Venice has JSON/stream-json/headless behavior but no equivalent documented modes/contracts for current Kimi `--print`, `--quiet`, `--acp`, and `--wire` surfaces.

Locate the current lines:

```bash
rg -n "print|quiet|acp|wire|stream-json|output-format" src/commands src/agent
```

**Failure mechanism**

Automation/editor integrations that expect those interaction contracts cannot map directly, and machine-mode behavior is less explicitly partitioned.

**Reproduction / proof target**

Inspect `venice agent --help` and command registration.

**Required remediation**

Do not copy flags cosmetically. Define whether compatibility is a goal; if yes, implement protocol semantics, stdout/stderr contracts, exit codes, and versioning before aliases.

**Regression tests**

Golden stdout/stderr/protocol fixtures and pipe/TTY matrices.

**Acceptance criteria**

Any advertised compatibility flag has the expected protocol semantics, not just a name.

---

### VCL-032 — Missing user-facing max-steps, retry-per-step, and Ralph-loop controls

**Severity:** P2  
**Confidence:** PARITY-GAP  
**Category:** Kimi parity / loop control

**Evidence anchor:** Current Kimi exposes `--max-steps-per-turn`, `--max-retries-per-step`, and Ralph-loop controls; equivalent Venice invocation controls are absent/incomplete.

Locate the current lines:

```bash
rg -n "max.*steps|max.*retries|ralph|loop.*control|maxTurns" src
```

**Failure mechanism**

Operators cannot reliably cap autonomous work/retries or request bounded iterative completion using familiar controls.

**Reproduction / proof target**

Inspect CLI help and runtime configuration.

**Required remediation**

First fix terminal-state semantics (VCL-010). Then add explicit loop-control configuration with hard caps, retry classification, side-effect-safe retry rules, and optional Ralph-style iterative loop.

**Regression tests**

Limits 0/1/N, retryable vs non-retryable errors, tool side effects, exhaustion terminal status.

**Acceptance criteria**

Loop controls are observable, bounded, and never replay stateful tools unsafely.

---

### VCL-033 — No actual plugin manifest/install/list/info/remove subsystem

**Severity:** P2  
**Confidence:** PARITY-GAP  
**Category:** Kimi parity / plugins

**Evidence anchor:** Repository search plus `/plugins` implementation; current Kimi has a plugin manifest and installation lifecycle.

Locate the current lines:

```bash
rg -n "plugin\.json|plugin install|plugin remove|plugin info|plugin list|PluginManager" src
```

**Failure mechanism**

Executable extensions cannot be distributed/managed as plugins even though the TUI has a `/plugins` label.

**Reproduction / proof target**

Attempt local-directory, ZIP, URL, and git plugin installation.

**Required remediation**

Create a separate plugin RFC before implementation: manifest schema, trusted roots, archive traversal defense, executable/tool registration, skill contribution, prompt contribution, version/provenance, signature/trust model, enable/disable, uninstall cleanup.

**Regression tests**

Schema fuzzing, path traversal ZIP, duplicate IDs, upgrade, rollback, untrusted executable confirmation.

**Acceptance criteria**

Plugin lifecycle is first-class and security-reviewed.

---

### VCL-034 — No `/undo` turn rollback UX despite checkpoint/fork primitives

**Severity:** P2  
**Confidence:** PARITY-GAP + EXISTING-PRIMITIVES  
**Category:** Kimi parity / session UX

**Evidence anchor:** `src/agent/checkpoints.ts`, session fork support, and slash registry lacking a Kimi-style undo/fork-to-prior-turn workflow.

Locate the current lines:

```bash
rg -n 'undo|checkpoint|fork|restore' src/agent src/ui
```

**Failure mechanism**

Users cannot easily branch from an earlier turn/message and re-edit while preserving the original session.

**Reproduction / proof target**

Inspect slash help after several turns and checkpoints.

**Required remediation**

Implement `/undo` as a non-destructive fork to a selected prior turn/checkpoint. Never rewrite original history in place. Show affected filesystem checkpoint semantics clearly.

**Regression tests**

Undo to multiple turns, no checkpoint, deleted files, session preservation, cancellation.

**Acceptance criteria**

Undo creates a safe branch and the original session remains intact.

---

### VCL-035 — `--session` / resume semantics are not aligned with Kimi-style identify-or-create behavior

**Severity:** P2  
**Confidence:** PARITY-GAP  
**Category:** Kimi parity / sessions

**Evidence anchor:** `src/commands/agent.ts` resume/session handling versus current Kimi session CLI behavior.

Locate the current lines:

```bash
rg -n "session|resume|continue" src/commands/agent.ts src/agent/sessions.ts
```

**Failure mechanism**

Scripts/users migrating from Kimi can encounter an error where they expect a named session to be selected/created, or can confuse `--resume`, `--session`, and `--continue` roles.

**Reproduction / proof target**

Invoke an absent named session ID and compare behavior with an existing ID/new session.

**Required remediation**

Choose explicit Venice semantics and document them, or implement compatibility: `--session [id]` identify/create, `--resume [id]` require existing, `--continue` most recent. Keep ambiguity out of persistence APIs.

**Regression tests**

Existing/absent/invalid IDs and workspace mismatch.

**Acceptance criteria**

Session selection semantics are unambiguous and covered by CLI tests.

---

### VCL-038 — Session event persistence rewrites growing delta-heavy history

**Severity:** P2  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Session durability / performance

**Evidence anchor:** `src/agent/sessions.ts` save/event serialization and agent event stream containing model/reasoning deltas.

Locate the current lines:

```bash
rg -n "events\.jsonl|session\.json|JSON\.stringify|writeFile|assistant_delta|reasoning" src/agent/sessions.ts src/agent/events.ts
```

**Failure mechanism**

Frequent delta events make session state large; full rewrites amplify I/O and crash windows as sessions grow.

**Reproduction / proof target**

Generate a long streaming session, sample session directory size and save latency after each turn.

**Required remediation**

Persist canonical compact state separately from an append-only/coalesced event journal. Coalesce transient deltas or omit them from durable history. Compact/index atomically.

**Regression tests**

10k/100k delta stress, crash during append/compaction, recovery.

**Acceptance criteria**

Save cost scales with new durable data rather than total historical streaming deltas.

---

### VCL-039 — Session schema/version handling needs strict future-version rejection and explicit migrations

**Severity:** P2  
**Confidence:** STRONG-SOURCE-INFERENCE  
**Category:** Session schema

**Evidence anchor:** `src/agent/sessions.ts` serialized state/version fields and load parsing.

Locate the current lines:

```bash
rg -n "schema|version|parse|JSON\.parse|migrat" src/agent/sessions.ts src/agent/runtime.ts
```

**Failure mechanism**

Permissive loading of structurally unexpected/future state risks silently dropping fields or interpreting incompatible semantics.

**Reproduction / proof target**

Edit a saved session to a future version and to malformed nested state, then resume.

**Required remediation**

Use a strict schema validator at the persistence boundary. Implement versioned migrations, reject unknown future versions, and preserve a backup before migration.

**Regression tests**

Every supported historical version, malformed fields, missing fields, future version.

**Acceptance criteria**

Unsupported session state fails explicitly without mutation or data loss.

---

### VCL-043 — History/usage persistence uses non-atomic whole-file writes

**Severity:** P2  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Durability

**Evidence anchor:** `src/lib/config.ts` and related history/usage save helpers.

Locate the current lines:

```bash
rg -n "history|usage|writeFile|writeFileSync|rename|fsync" src/lib src/commands
```

**Failure mechanism**

Process termination or disk error during rewrite can leave truncated JSON and destroy the previous valid store.

**Reproduction / proof target**

Fault-inject/kill process between truncate and completed write.

**Required remediation**

Use shared atomic JSON persistence: write same-directory temp, flush, rename, optionally fsync parent directory, preserve permissions.

**Regression tests**

Injected write/rename failures and crash-recovery fixtures.

**Acceptance criteria**

A failed write leaves either the previous valid file or the complete new file, never partial JSON.

---

### VCL-044 — Corrupt history/usage stores can be treated as empty and later overwritten

**Severity:** P2  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Durability

**Evidence anchor:** History/usage read error fallback behavior in config/lib persistence helpers.

Locate the current lines:

```bash
rg -n "history|usage|JSON\.parse|catch|\\[\\]|return.*empty" src/lib
```

**Failure mechanism**

Silent empty fallback followed by a write turns recoverable corruption into irreversible data loss.

**Reproduction / proof target**

Corrupt history/usage JSON and trigger the next normal write.

**Required remediation**

Quarantine/backup corrupt data, report a diagnostic, and avoid destructive overwrite until recovery policy is explicit. Prefer append-safe/event storage for history.

**Regression tests**

Corrupt partial JSON, wrong schema, permission denial.

**Acceptance criteria**

Corruption is surfaced and original bytes remain recoverable.

---

### VCL-046 — Early `tools/list_changed` notification can race manager state registration

**Severity:** P2  
**Confidence:** SOURCE-CONFIRMED  
**Category:** MCP lifecycle

**Evidence anchor:** `src/mcp/manager.ts` startup ordering and refresh callback lookup by server name.

Locate the current lines:

```bash
rg -n "list_changed|refreshServerTools|set\\(|servers|start" src/mcp/manager.ts src/mcp/client.ts
```

**Failure mechanism**

A server can emit tool-list-changed during startup before its manager state is inserted; refresh-by-name then finds nothing and the update is lost.

**Reproduction / proof target**

Mock a server that emits the notification immediately upon initialize/connection.

**Required remediation**

Register an `initializing` server state before client startup, or bind the notification directly to the concrete client/state object and serialize refreshes.

**Regression tests**

Immediate, repeated, concurrent, and post-crash list-changed notifications.

**Acceptance criteria**

No valid tool-list change is lost due to startup ordering.

---

### VCL-047 — Manager connection status can become stale after a server process exits

**Severity:** P2  
**Confidence:** STRONG-SOURCE-INFERENCE  
**Category:** MCP lifecycle

**Evidence anchor:** `src/mcp/client.ts` exit/error handling and `src/mcp/manager.ts` stored connected/error status.

Locate the current lines:

```bash
rg -n "exit|close|error|connected|status|isRunning" src/mcp/client.ts src/mcp/manager.ts
```

**Failure mechanism**

The client rejects pending requests on exit, but manager-visible status is not guaranteed to transition through the same lifecycle event. TUI may continue to show a server as connected.

**Reproduction / proof target**

Connect a stdio MCP server, kill it externally, then invoke `/mcp` and a tool.

**Required remediation**

Emit typed lifecycle events from client to manager (`connecting/connected/exited/error/restarting/stopped`) with timestamps/last error. Derive status from live state.

**Regression tests**

Clean exit, crash, spawn failure, restart, shutdown.

**Acceptance criteria**

MCP status reflects actual process/transport liveness within one lifecycle event.

---

### VCL-050 — SSE parsing is line-centric and does not fully assemble multi-line SSE events

**Severity:** P2  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Streaming correctness

**Evidence anchor:** `src/lib/api.ts` stream parser handling of `data:` lines.

Locate the current lines:

```bash
rg -n "data:|split|newline|SSE|event:" src/lib/api.ts
```

**Failure mechanism**

SSE permits multiple `data:` lines per event separated by a blank line. Treating each line as standalone JSON can reject or misparse compliant multi-line events/comments/CRLF framing.

**Reproduction / proof target**

Feed fixtures containing CRLF, comments, blank lines, and two `data:` lines that together form one event payload.

**Required remediation**

Implement an SSE event-frame parser: normalize CRLF, accumulate fields until blank event delimiter, join data lines with newline, then decode the completed event.

**Regression tests**

RFC-style framing fixtures plus chunk boundaries in every byte position.

**Acceptance criteria**

Parsing depends on SSE event boundaries, not TCP/read or individual-line boundaries.

---

### VCL-051 — Hard-coded stream idle timeout can falsely fail legitimate long-silent model phases

**Severity:** P2  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Streaming reliability

**Evidence anchor:** `src/lib/api.ts` stream idle timeout constant/logic.

Locate the current lines:

```bash
rg -n "IDLE_TIMEOUT|idle.*timeout|STREAM_IDLE|30000|30_000" src/lib/api.ts
```

**Failure mechanism**

Reasoning/tool preparation or provider buffering can legitimately exceed a fixed short no-byte interval. The client then treats healthy work as a network failure.

**Reproduction / proof target**

Mock a valid stream with silence longer than the configured idle window before a valid next event.

**Required remediation**

Make idle timeout configurable and model/provider aware, distinguish connect/header/idle/overall timeouts, and honor heartbeat/comment frames as activity where appropriate.

**Regression tests**

Silence just below/above threshold, heartbeat-only interval, explicit cancellation.

**Acceptance criteria**

Timeout policy is configurable, documented, and does not conflate overall duration with no-activity duration.

---

### VCL-052 — `stream-json` turn correlation is inconsistent for model-request records

**Severity:** P2  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Machine protocol

**Evidence anchor:** `src/ui/renderer.ts`, `src/agent/events.ts`, and model-request event mapping.

Locate the current lines:

```bash
rg -n "turnId|eventId|model_request|stream-json|streamJson" src/ui/renderer.ts src/agent/events.ts src/agent/runtime.ts
```

**Failure mechanism**

Renderer logic can use an event ID as a turn ID for one event class while other records carry the runtime turn ID. Downstream consumers cannot reliably group one turn.

**Reproduction / proof target**

Run one multi-step/tool turn in `stream-json` and group records by `turnId`; inspect model-request entries.

**Required remediation**

Every event must carry explicit stable `sessionId`, `turnId`, `stepId` (where applicable), `eventId`, and `toolCallId` (where applicable). Renderer must not synthesize semantic IDs from unrelated IDs.

**Regression tests**

JSON-schema/golden protocol tests for multi-step turns.

**Acceptance criteria**

All events from one foreground turn share exactly one stable `turnId`.

---

### VCL-053 — Machine stream lacks a single canonical versioned terminal result/error envelope

**Severity:** P2  
**Confidence:** ARCHITECTURAL-GAP  
**Category:** Machine protocol

**Evidence anchor:** `src/agent/stream-json.ts`, `src/ui/renderer.ts`, and event terminal handling.

Locate the current lines:

```bash
rg -n "version|final|terminal|error|complete|stream-json" src/agent/stream-json.ts src/ui/renderer.ts src/agent/events.ts
```

**Failure mechanism**

Automation consumers must infer whether a stream completed, cancelled, hit a limit, or failed from event mixtures/prose.

**Reproduction / proof target**

Capture JSONL for success, model error, tool error, cancellation, and budget exhaustion.

**Required remediation**

Version the protocol and emit exactly one terminal `result` record with status, IDs, usage, final text/reference, error object, and incomplete reason. Keep stderr for human diagnostics.

**Regression tests**

One-terminal-record invariant and schema compatibility fixtures.

**Acceptance criteria**

A consumer can determine outcome from the terminal record alone.

---

### VCL-054 — Tool start/finish correlation should be guaranteed by stable IDs in every protocol record

**Severity:** P2  
**Confidence:** ARCHITECTURAL-GAP  
**Category:** Machine protocol

**Evidence anchor:** Tool event definitions/mapping in `src/agent/events.ts`, runtime, and renderer.

Locate the current lines:

```bash
rg -n "toolCallId|tool_start|tool_complete|tool_result|turnId|stepId" src/agent/events.ts src/agent/runtime.ts src/ui/renderer.ts
```

**Failure mechanism**

If correlation fields are optional/inconsistent, concurrent/future background tasks and retries make it impossible for clients to pair tool lifecycle events safely.

**Reproduction / proof target**

Run multiple tool calls in one turn and inspect JSONL fields.

**Required remediation**

Make correlation IDs mandatory at type/schema level for tool lifecycle records. Do not infer pairing by order.

**Regression tests**

Parallel-looking sequence fixtures, retries, failure, cancellation.

**Acceptance criteria**

Every tool terminal record references exactly one prior tool-start ID in the same session/turn.

---

### VCL-055 — Transcript updates accumulate per-delta items and repeatedly search a growing collection

**Severity:** P2  
**Confidence:** SOURCE-CONFIRMED  
**Category:** TUI performance

**Evidence anchor:** `src/ui/transcript.tsx` and `src/ui/app.tsx` transcript/event reducer behavior.

Locate the current lines:

```bash
rg -n "transcript|delta|find\\(|setTranscript|assistant_delta|reasoning" src/ui/app.tsx src/ui/transcript.tsx
```

**Failure mechanism**

Long streams produce many small updates; repeated linear lookup plus React state copies/renders can approach quadratic work and make the TUI increasingly sluggish.

**Reproduction / proof target**

Replay tens of thousands of deltas and profile render/update time and heap growth.

**Required remediation**

Keep an indexed map keyed by message/turn ID, coalesce deltas on a short frame interval, and window/virtualize old transcript rows if needed.

**Regression tests**

Performance regression benchmark with a fixed 50k-delta fixture.

**Acceptance criteria**

Per-delta processing remains near O(1) amortized and TUI responsiveness does not materially degrade with long output.

---

### VCL-059 — Shell timeout input needs strict finite integer bounds

**Severity:** P2  
**Confidence:** SOURCE-CONFIRMED  
**Category:** Shell robustness

**Evidence anchor:** Shell tool argument parsing/timeout use in `src/tools/shell/execute.ts` and tool schema.

Locate the current lines:

```bash
rg -n "timeoutMs|timeout|Number|parse" src/tools/shell src/lib/tools.ts
```

**Failure mechanism**

Unbounded, non-finite, negative, or extreme timeout values can produce unexpected timer behavior or effectively disable safety limits.

**Reproduction / proof target**

Pass negative, zero, fractional, `NaN`-like, huge, and maximum numeric values through schema/JSON.

**Required remediation**

Schema-validate an integer range with a documented default/max and optional explicit privileged override.

**Regression tests**

Boundary table.

**Acceptance criteria**

Invalid timeout values are rejected before process spawn.

---

### VCL-061 — `api:contract` is a pinned deterministic contract check, not a live upstream drift detector

**Severity:** P2  
**Confidence:** SOURCE-CONFIRMED  
**Category:** API contract / CI

**Evidence anchor:** `scripts/api-drift-check.mjs` hard-coded upstream revision/selected OpenAPI paths and package script naming.

Locate the current lines:

```bash
rg -n "github|sha|commit|openapi|swagger|drift|api:contract" scripts/api-drift-check.mjs package.json
```

**Failure mechanism**

A pinned check is good for reproducibility, but it cannot tell maintainers that Venice's current official API changed after that SHA. Calling it drift detection can create false confidence.

**Reproduction / proof target**

Advance upstream docs while leaving pinned SHA unchanged; deterministic CI remains green with respect to the pin.

**Required remediation**

Split responsibilities: keep `api:contract` pinned and deterministic; add a scheduled/manual `api:drift` job that resolves current official upstream, compares supported surfaces, and reports/opens an issue without making ordinary builds nondeterministic.

**Regression tests**

Pinned fixture test plus mock upstream-newer drift report.

**Acceptance criteria**

CI clearly distinguishes 'implementation matches pinned contract' from 'pinned contract is still current upstream'.

---

### VCL-036 — Plan mode exists but needs semantic parity verification beyond the presence of `/plan`

**Severity:** P3  
**Confidence:** PARITY-REVIEW  
**Category:** Kimi parity / plan mode

**Evidence anchor:** Venice plan-mode state/tools and current Kimi plan-mode read-only/planning semantics.

Locate the current lines:

```bash
rg -n "planMode|operatingMode|plan|read.?only" src/agent src/ui src/tools
```

**Failure mechanism**

A slash command/flag named plan can still diverge in tool restrictions, persistence, resume behavior, and plan revision lifecycle.

**Reproduction / proof target**

Start/resume plan sessions, attempt every mutating tool class, switch mode, edit plan, and execute.

**Required remediation**

Write a plan-mode contract: allowed tools, plan artifact location, transition rules, resume precedence, and execution handoff. Enforce at authorization/tool registry, not just prompt wording.

**Regression tests**

Mutating-tool denial matrix and resume/transition scenarios.

**Acceptance criteria**

Plan mode is technically read-only except for the designated plan artifact and behaves consistently across restart.

---

### VCL-048 — MCP tool adapter should fail fast on known disconnected state

**Severity:** P3  
**Confidence:** STRONG-SOURCE-INFERENCE  
**Category:** MCP runtime

**Evidence anchor:** Runtime MCP tool invocation adapter and client running-state APIs.

Locate the current lines:

```bash
rg -n "isRunning|invoke.*mcp|callTool|MCP" src/agent/runtime.ts src/mcp
```

**Failure mechanism**

A known-dead server can be attempted and fail late with a lower-quality transport error.

**Reproduction / proof target**

Kill a server then invoke one of its registered tools.

**Required remediation**

Check current manager/client lifecycle state immediately before invocation and return a typed `MCP_SERVER_UNAVAILABLE` error with restart guidance.

**Regression tests**

Dead-before-call and dies-during-call.

**Acceptance criteria**

Known disconnected servers fail immediately with actionable status.

---

### VCL-060 — `chat --parallel-tool-calls <bool>` uses permissive string-to-boolean semantics

**Severity:** P3  
**Confidence:** SOURCE-CONFIRMED  
**Category:** CLI parsing

**Evidence anchor:** `src/commands/chat.ts` parser for `parallel-tool-calls`.

Locate the current lines:

```bash
rg -n "parallel-tool-calls|parallelToolCalls|false" src/commands/chat.ts
```

**Failure mechanism**

Values other than the exact string `false` can become true, so typos such as `flase` silently enable the behavior.

**Reproduction / proof target**

Invoke with `false`, `FALSE`, `0`, `no`, `flase`, and invalid text.

**Required remediation**

Use a strict boolean parser or Commander positive/negative flags (`--parallel-tool-calls` / `--no-parallel-tool-calls`).

**Regression tests**

CLI parsing table.

**Acceptance criteria**

Invalid boolean values fail fast; valid values have one documented spelling/behavior.

---

## 5. Kimi-CLI Parity Matrix

This is a **target comparison**, not an instruction to clone Kimi indiscriminately. Implement a row only when Venice intends semantic parity.

Current official Kimi sources used for this comparison:

- Kimi CLI command reference: `https://github.com/MoonshotAI/kimi-cli/blob/main/docs/en/reference/kimi-command.md`
- Kimi Agent Skills: `https://github.com/MoonshotAI/kimi-cli/blob/main/docs/en/customization/skills.md`
- Kimi Plugins: `https://github.com/MoonshotAI/kimi-cli/blob/main/docs/en/customization/plugins.md`
- Kimi changelog/current behavior: `https://github.com/MoonshotAI/kimi-cli/blob/main/CHANGELOG.md`

| Capability | Current Kimi target | Venice at reviewed SHA | Status | Priority / target |
|---|---|---|---|---|
| Continue recent session | `--continue` | Session/resume functionality exists | Partial | Normalize semantics and override precedence |
| Named session | `--session [ID]` semantics | Resume/session handling differs | Partial | Decide compatibility; test absent/existing IDs |
| Resume | `--resume [ID]` | Present | Present but buggy | Fix context budget + CLI override precedence |
| Plan mode | `--plan`, persisted/resumed plan state | Present | Partial | Verify read-only enforcement and lifecycle |
| Thinking toggle | `--thinking` / `--no-thinking` | Effort-oriented controls | Missing | Add capability-gated boolean separate from effort |
| Skills dir | repeatable `--skills-dir` / extra dirs | Extra skill roots exist | Partial | Align precedence/canonical path semantics |
| Skill layout | `<name>/SKILL.md` + flat `<name>.md` | Canonical directory form | Missing flat form | Add both layouts |
| Skill precedence | Project > User > Extra > Built-in | Loop/Map order can make Extra win | Incorrect | Explicit precedence comparator |
| Skill invocation | `/skill:<name> [task]` | `/skill ...` form | Partial | Add colon form and task arguments |
| Plugins | manifest + install/list/info/remove | `/plugins` is not true plugin lifecycle | Missing | Build subsystem or rename command |
| `/btw` | isolated side question | Not found | Missing | Add after core context invariants |
| Background tasks / `/task` | explicit task lifecycle | Not found | Missing | Add only after foreground concurrency is correct |
| AFK | unattended mode distinct from raw yolo | No distinct AFK | Missing | Model separately from permission bypass |
| Runtime add-dir | Kimi interaction supports workspace expansion patterns | Startup `--add-dir` only | Partial | Add safe runtime `/add-dir` if desired |
| `/undo` | non-destructive earlier-turn fork UX | Checkpoint/fork primitives exist | Missing UX | Implement as safe branch/fork |
| Max steps / retries | explicit loop-control flags | Internal ceilings but incomplete user surface | Partial | Add documented invocation controls |
| Ralph loop | bounded iterative loop | Not found | Missing | Add only after safe loop terminal states |
| Print / quiet | non-TUI modes | JSON/headless variants exist | Different | Define compatibility instead of aliases only |
| ACP / wire | protocol integration modes | Not found | Missing | Only implement with protocol-level tests |
| MCP lifecycle | mature configuration/interaction | MCP transport/manager exists | Partial | Add add/remove/enable/disable/restart/doctor |
| Config UX | built-in skills/config editing ecosystem | `/config` mostly inspects | Partial | Implement actionable config surface |
| Reload | reload semantics | Skill rediscovery presented broadly | Incorrect UX | Make behavior truthful or broaden implementation |
| Theme | `/theme` surface exists | Present | Present | Verify persistence/reload and no active-turn mutation |
| Effort | `/effort` surface exists | Present | Present | Keep separate from thinking toggle |
| Compact | `/compact` exists | Present | Present but context bugs nearby | Fix compaction invariants first |
| New/fork/sessions | session UX exists | Present | Present but concurrency/resume bugs | Gate mutations on idle/turn boundary |

### Parity rule

Do not mark a feature as complete because a command name exists. Parity requires:
- the same user intent;
- equivalent state transition;
- equivalent persistence/resume behavior where applicable;
- equivalent permission/cancellation semantics;
- documented failure modes;
- regression tests.

---

## 6. Recommended Architecture Changes

### 6.1 Introduce a structured turn payload

Replace string queues/injections with something conceptually like:

```ts
export interface TurnAttachment {
  displayPath: string;
  canonicalPath: string;
  content: string;
  bytes: number;
  sha256?: string;
}

export interface TurnPayload {
  text: string;
  attachments: TurnAttachment[];
  enqueuedAt: number;
  source: "interactive" | "queued" | "injected" | "headless";
}
```

The exact names can differ. The invariant cannot: attachments belong to the turn, not to ambient context.

### 6.2 Introduce a foreground execution state machine

Suggested states:

```text
idle
preparing
streaming_model
running_tool
finalizing
cancelling
failed
```

A `TurnExecution` should carry:

```ts
interface TurnExecution {
  sessionId: string;
  turnId: string;
  controller: AbortController;
  payload: TurnPayload;
  completion: Promise<TurnResult>;
}
```

`/new`, `/resume`, `/model`, `/plan`, config mutation, and foreground direct tools must use this state machine rather than checking an independent React boolean.

### 6.3 Separate desired mode from effective capability

Example:

```ts
interface RequestedAgentSettings {
  operatingMode: "chat" | "agent" | "plan";
  thinkingEnabled?: boolean;
  reasoningEffort?: "low" | "medium" | "high";
}

interface EffectiveCapabilities {
  canUseTools: boolean;
  canThink: boolean;
  contextLimit?: number;
}
```

If model discovery fails, capability should fail closed. Do not infer tool support from the requested mode.

### 6.4 Rebuild context from explicit layers

Do not mutate one shared context blob in place. Keep:
- system contract;
- instruction scopes;
- durable conversation;
- compacted summary/history;
- active-turn attachments;
- active user message

as separate typed layers until request serialization.

### 6.5 Centralize atomic persistence

Create one tested helper for JSON state:

```text
read strict -> validate schema -> mutate in memory
-> write same-directory temp -> flush
-> atomic rename -> fsync directory where supported
```

For corrupt files:
- never return `{}`/`[]` and later overwrite silently;
- preserve original bytes;
- report recovery instructions.

### 6.6 Security-bound all filesystem writes

Use `WorkspaceManager` (or one equivalent canonical path service) for:
- tool writes;
- checkpoint restore;
- plan files;
- plugin installation;
- imported file restoration.

Do not let each subsystem implement a weaker lexical `resolve()` check.

### 6.7 Treat shell parsing as capability policy

Recommended model:

```text
known read-only built-in tools -> safe capability
known structured mutating tools -> policy-controlled capability
raw shell command -> unknown/high-power capability
```

Risk regexes may enrich prompts/UI, but a miss must not auto-authorize raw shell.

### 6.8 Give MCP a lifecycle state machine

Per-server state:

```text
disabled
starting
connected
degraded
exited
restarting
stopped
error
```

Include `lastError`, `lastTransitionAt`, retry count, and current tool generation.

### 6.9 Version the machine protocol

Example terminal record:

```json
{
  "protocol": "venice-agent-stream",
  "version": 1,
  "type": "result",
  "sessionId": "…",
  "turnId": "…",
  "status": "completed",
  "usage": {},
  "finalText": "…",
  "error": null
}
```

For limit exhaustion:

```json
{
  "protocol": "venice-agent-stream",
  "version": 1,
  "type": "result",
  "sessionId": "…",
  "turnId": "…",
  "status": "limit_reached",
  "incompleteReason": "max_steps_per_turn",
  "error": null
}
```

Never require consumers to scrape a human note.

---

## 7. Implementation Phases

### Phase 0 — Green baseline

Scope:
- VCL-062
- establish exact local/CI failure
- no feature work

Exit:
- `npm run verify` green locally;
- CI quality/platform/runtime matrices green.

### Phase 1 — Foreground turn ownership and cancellation

Scope:
- VCL-001
- VCL-002
- VCL-003
- VCL-004
- VCL-058

Deliverables:
- immutable per-turn abort signal;
- runtime-owned busy/execution state;
- central command safety classes;
- direct-tool lock;
- subprocess cancellation.

Exit:
- cancellation race suite green;
- no post-cancel model/tool side effects.

### Phase 2 — Context, queue, compaction, resume

Scope:
- VCL-005
- VCL-006
- VCL-007
- VCL-008
- VCL-009
- VCL-012
- VCL-016
- VCL-017

Deliverables:
- structured `TurnPayload`;
- ephemeral attachments;
- explicit context layers;
- corrected model-profile application;
- scoped rule resolution;
- resume override contract.

Exit:
- queued/resumed/file-context tests green.

### Phase 3 — Durability and filesystem security

Scope:
- VCL-037 through VCL-044
- session-related VCL-011
- schema migration hardening

Deliverables:
- workspace-scoped deletion;
- safe plan path derivation;
- symlink-safe restore;
- strict/atomic config/history/session persistence;
- canonical chat continuation.

Exit:
- data-loss/security tests green.

### Phase 4 — Streaming and machine protocol

Scope:
- VCL-010
- VCL-013
- VCL-014
- VCL-049 through VCL-054

Deliverables:
- truncated-stream detection;
- proper SSE framing;
- configurable timeout policy;
- versioned JSONL protocol;
- explicit incomplete state.

Exit:
- protocol fixtures stable and parsable.

### Phase 5 — MCP, skills, and truthful slash surfaces

Scope:
- VCL-018 through VCL-025
- VCL-045 through VCL-048
- VCL-061

Deliverables:
- real reload semantics or truthful rename;
- actionable config;
- MCP lifecycle management;
- Kimi-compatible skill precedence/layout/invocation;
- canonical skill path;
- deterministic contract vs live drift separation.

Exit:
- slash help is truthful;
- skill/MCP test suites green.

### Phase 6 — Kimi-style advanced capabilities

Scope:
- VCL-026 through VCL-036

Order:
1. thinking toggle;
2. runtime add-dir;
3. undo/fork UX;
4. AFK;
5. side query;
6. background tasks;
7. loop controls/Ralph;
8. true plugin subsystem;
9. optional print/quiet/ACP/wire compatibility.

Do not start background tasks before Phase 1. Do not start plugin installation before filesystem/path/persistence hardening.

### Phase 7 — Performance and minor correctness

Scope:
- VCL-055
- VCL-056
- VCL-059
- VCL-060
- remaining UX/documentation cleanup

Exit:
- transcript stress benchmark passes;
- math property tests pass;
- strict parser behavior documented.

---

## 8. Regression Test Files to Add or Extend

Suggested names; adapt to existing repository conventions:

```text
test/ui/turn-cancellation.test.tsx
test/ui/slash-command-busy-gating.test.tsx
test/agent/runtime-concurrency.test.ts
test/agent/context-resume.test.ts
test/agent/queued-attachments.test.ts
test/agent/attachment-isolation.test.ts
test/agent/compaction-current-turn.test.ts
test/agent/model-capability-gating.test.ts
test/agent/loop-terminal-status.test.ts
test/agent/session-scope.test.ts
test/agent/resume-overrides.test.ts
test/security/checkpoint-symlink.test.ts
test/security/plan-path.test.ts
test/security/shell-policy.test.ts
test/config/corruption.test.ts
test/config/atomic-write.test.ts
test/mcp/config-validation.test.ts
test/mcp/lifecycle.test.ts
test/api/stream-truncation.test.ts
test/api/sse-framing.test.ts
test/api/stream-timeout.test.ts
test/protocol/stream-json.test.ts
test/tools/shell-abort.test.ts
test/tools/shell-timeout-validation.test.ts
test/tools/math-functions.test.ts
test/chat/continue-persistence.test.ts
test/skills/precedence.test.ts
test/skills/flat-layout.test.ts
test/skills/invocation.test.ts
test/cli/machine-output-conflicts.test.ts
test/cli/boolean-options.test.ts
```

### Required adversarial scenarios

#### Cancellation race

```text
turn A starts model stream
Ctrl-C
turn B submitted immediately
assert A emits nothing after cancellation finalizes
assert A launches no tools
assert B owns one new AbortSignal
```

#### Queued attachment isolation

```text
turn A: "read @secret-marker.txt"
turn B queued: "say hello"
assert B outbound request does not contain secret marker
```

#### Resume/compaction

```text
save session with modelProfile.contextLimit = N
restart/resume
assert ContextManager limit == N before first request
assert an @file on first resumed turn survives compaction
```

#### Config corruption

```text
write malformed config bytes
run config set
assert non-zero failure
assert original bytes preserved/backed up
assert no empty config overwrite
```

#### Workspace session isolation

```text
workspace A session A
workspace B session B
from A attempt delete(B)
assert denied
assert B directory remains
```

#### Checkpoint symlink

Use only temporary test directories:

```text
checkpoint workspace/dir/file
replace workspace/dir with symlink to external temp dir
restore
assert restore refuses
assert external target unchanged
```

#### Stream truncation

```text
SSE: data delta
socket EOF without terminal marker
assert STREAM_TRUNCATED
assert no successful terminal result
```

#### Machine protocol

```bash
venice agent -p "..." --output-format stream-json   | jq -ce . >/dev/null
```

Then assert:
- one `sessionId`;
- one foreground `turnId`;
- unique `eventId`;
- stable tool-call IDs;
- exactly one terminal result.

---

## 9. Manual Acceptance Matrix

Run after automated tests:

### Interactive TUI

- Start a long streaming reply, cancel it, immediately submit another prompt.
- Cancel during a shell tool that has a spawned child.
- Queue a prompt containing `@file` while the first turn runs.
- Queue a second prompt without a file and verify no attachment leakage.
- Run `/new`, `/resume`, `/model`, `/plan`, `/permissions`, `/reload` while busy; verify policy is consistent.
- Resume a session close to context limit and attach a file.
- Change model to one whose profile lookup fails.
- Use shell passthrough during active turn; verify it queues/refuses rather than overlaps.

### Sessions

- Create/fork/resume across two different workspaces.
- Attempt cross-workspace deletion.
- Import malformed/future session state.
- Verify `--model`, `--mode`, and `--add-dir` override semantics on resume.
- Verify legacy `chat --continue` includes the previous assistant reply.

### MCP

- Valid stdio server.
- Valid network server.
- Invalid/null entry alongside one valid server.
- Server emits tool-list-changed immediately at startup.
- Server crashes after successful connection.
- Restart/disable/enable from TUI if implemented.

### Config

- Malformed JSON.
- Read-only config.
- Interrupted write fault injection.
- Secret/API-key redaction in every diagnostic/config display.
- `/reload` after on-disk changes.

### Skills

- Project/user/extra same-name collision.
- Canonical `<name>/SKILL.md`.
- Flat `<name>.md`.
- `/skill:<name>`.
- `/skill:<name> task text`.
- Launch from repository subdirectory if project-root discovery is intended.
- Canonical path displayed by `/config` and `/plugins`.

### Streaming

- Clean completion.
- EOF before completion.
- CRLF.
- comments/heartbeat.
- multi-line `data:` event.
- very slow but valid stream.
- cancellation before headers.
- cancellation mid-event.

---

## 10. Full Validation Commands

Use the repository's own gates. Do not substitute only a targeted test run.

```bash
npm ci

npm run lint
npm run typecheck
npm run build

npm run test:compiled
npm run test:security

npm run completions:check
npm run api:contract
npm audit --omit=dev
npm run pack:check

npm run verify
```

For GitHub Actions:

```bash
gh run list --repo spearchucker667/venice-cli --branch main --limit 10
gh run view 32023242246 --repo spearchucker667/venice-cli --log-failed
```

For package smoke testing after a green build:

```bash
npm pack --dry-run
npm pack
```

Inspect the tarball before any publish. Confirm package name, version, bin entry, built files, README/license, and absence of secrets/local audit artifacts.

---

## 11. Do-Not Rules

1. **Do not** add concurrency/background tasks before foreground turn ownership is correct.
2. **Do not** fix cancellation by only toggling React `isRunning`; network and subprocess work must receive the same immutable turn abort.
3. **Do not** store active-turn attachments as ambient context shared across queued turns.
4. **Do not** compact the current turn's attachments/user message away.
5. **Do not** treat zero/unknown context length as a valid zero budget.
6. **Do not** fail open to tool mode when model capability discovery fails.
7. **Do not** return `complete` for max-step/max-turn exhaustion.
8. **Do not** silently parse corrupt config/history/session state as empty and later overwrite the source.
9. **Do not** trust serialized absolute file paths for deletion or restore.
10. **Do not** implement a weaker path check in checkpoint/plugin/plan code than the workspace manager.
11. **Do not** use shell regexes as the authorization boundary for `auto`.
12. **Do not** leave child processes alive after a cancelled tool.
13. **Do not** retry a request if doing so can duplicate an already-executed stateful tool side effect.
14. **Do not** declare stream success on raw EOF without a valid completion condition.
15. **Do not** emit human TUI text/control sequences on machine-mode stdout.
16. **Do not** synthesize a `turnId` from an unrelated event ID.
17. **Do not** rename skills/MCP as “plugins” unless an actual plugin lifecycle exists.
18. **Do not** copy Kimi flags solely for cosmetic parity; copy semantics or document the difference.
19. **Do not** make live upstream API drift a nondeterministic blocking dependency of ordinary builds; separate pinned contract from scheduled drift.
20. **Do not** merge parity work while `main` CI remains red.

---

## 12. Definition of Done

The stabilization/parity effort is complete only when all of the following are true:

### Correctness

- one foreground turn owner at a time;
- cancellation stops HTTP streams and subprocess trees;
- no stale cancelled turn can mutate the next session/turn;
- queued attachments are preserved and isolated;
- compaction preserves the active turn;
- resumed sessions apply model context limits correctly;
- model tools are capability-gated;
- incomplete loop termination is machine-visible as incomplete.

### Durability/security

- config/session/history writes are atomic or append-safe as appropriate;
- corrupt state is surfaced and recoverable;
- session deletion is workspace-scoped;
- plan cleanup derives a safe path;
- checkpoint restore cannot escape through symlinks;
- raw shell auto-approval fails closed for unknown high-power commands.

### Streaming/protocol

- truncated streams fail explicitly;
- SSE framing handles valid event boundaries;
- timeout classes are documented/configurable;
- machine protocol has stable IDs and one versioned terminal record;
- machine stdout is parseable.

### Extensions/parity

- `/reload`, `/config`, `/plugins`, `/mcp` descriptions match reality;
- skill location, precedence, formats, and invocation are deterministic;
- any implemented Kimi-like feature passes semantic parity tests;
- advanced concurrency/plugin features are added only after security invariants.

### CI/release

- `npm run verify` passes;
- GitHub quality/platform/runtime matrices pass;
- package dry-run/tarball inspection passes;
- no secrets, local paths, or audit-only artifacts ship.

---

## 13. Pinned Source Index

Review these at the pinned commit before editing:

- `package.json` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/package.json
- `AGENTS.md` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/AGENTS.md
- `.github/workflows/ci.yml` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/.github/workflows/ci.yml
- `.github/workflows/publish.yml` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/.github/workflows/publish.yml
- `scripts/api-drift-check.mjs` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/scripts/api-drift-check.mjs
- `src/index.ts` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/index.ts
- `src/commands/agent.ts` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/commands/agent.ts
- `src/commands/chat.ts` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/commands/chat.ts
- `src/commands/config.ts` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/commands/config.ts
- `src/ui/app.tsx` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/ui/app.tsx
- `src/ui/slash-commands.ts` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/ui/slash-commands.ts
- `src/ui/slash-handlers.ts` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/ui/slash-handlers.ts
- `src/ui/tui.tsx` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/ui/tui.tsx
- `src/ui/renderer.ts` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/ui/renderer.ts
- `src/ui/transcript.tsx` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/ui/transcript.tsx
- `src/ui/events.ts` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/ui/events.ts
- `src/ui/mentions.ts` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/ui/mentions.ts
- `src/agent/runtime.ts` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/agent/runtime.ts
- `src/agent/context.ts` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/agent/context.ts
- `src/agent/sessions.ts` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/agent/sessions.ts
- `src/agent/instructions.ts` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/agent/instructions.ts
- `src/agent/checkpoints.ts` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/agent/checkpoints.ts
- `src/agent/workspace.ts` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/agent/workspace.ts
- `src/agent/model-client.ts` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/agent/model-client.ts
- `src/agent/permissions.ts` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/agent/permissions.ts
- `src/agent/stream-json.ts` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/agent/stream-json.ts
- `src/agent/events.ts` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/agent/events.ts
- `src/lib/api.ts` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/lib/api.ts
- `src/lib/config.ts` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/lib/config.ts
- `src/lib/tools.ts` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/lib/tools.ts
- `src/skills/registry.ts` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/skills/registry.ts
- `src/mcp/config.ts` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/mcp/config.ts
- `src/mcp/manager.ts` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/mcp/manager.ts
- `src/mcp/client.ts` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/mcp/client.ts
- `src/tools/shell/execute.ts` — https://github.com/spearchucker667/venice-cli/blob/61fcefa06f8abc46e450bce6ee539edac7169800/src/tools/shell/execute.ts

---

## 14. Handoff Summary for the Implementing Agent

The repository is not primarily blocked by missing slash-command names. The highest-risk issues are lower-level invariants:

1. cancellation/turn ownership can race;
2. model HTTP cancellation is not fully propagated;
3. active-turn state can be replaced while work is still running;
4. queued file context can be dropped or leaked;
5. resumed context budgeting can initialize incorrectly;
6. persistent paths/config recovery have data-loss/security edges;
7. raw shell risk classification is too weak to authorize auto execution;
8. streaming can accept unexpected EOF as success;
9. machine protocol correlation/terminal semantics need tightening;
10. current `main` CI is red.

Fix those first. Then make slash surfaces truthful, correct skills/MCP behavior, and add the Kimi-style capabilities in the phase order above.

When the implementation is finished, produce a closure report that maps every `VCL-###` to one of:

```text
FIXED — commit + tests
NOT REPRODUCIBLE — evidence
ALREADY FIXED UPSTREAM — commit + evidence
DEFERRED — explicit maintainer decision + reason
PARITY NOT DESIRED — documented product decision
```

No item should disappear silently.

