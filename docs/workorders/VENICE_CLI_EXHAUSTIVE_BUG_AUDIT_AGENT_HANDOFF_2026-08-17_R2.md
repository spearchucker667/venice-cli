# Venice CLI — Exhaustive Bug Audit R2 — Agent Handoff

**Repository:** https://github.com/spearchucker667/venice-cli
**Reviewed branch:** `main`
**Pinned reviewed commit:** `ee2bf41d982cc6ca6de6e0a747e74ac8bc19107a`
**Prior audit baseline:** `61fcefa06f8abc46e450bce6ee539edac7169800` (see `VENICE_CLI_EXHAUSTIVE_BUG_AUDIT_AGENT_HANDOFF_2026-08-17.md`)
**Audit date:** 2026-08-17 (R2)
**Package observed at reviewed source:** `@spearchucker667/venice-cli` `2.1.0`
**Primary objective:** stabilize the CLI as a production-grade agent CLI first, then close intentional Kimi-style capability gaps without copying names that do not have equivalent semantics.

---

## 0. Read This First — Scope, Evidence, and Execution Rules

This is the **R2** regression handoff. It supersedes nothing in the prior document; instead it (a) reclassifies the prior 62 findings against the current tree and (b) records a **new** set of high-value defects found in a fresh source-level scan at `ee2bf41`.

Every finding carries a **confidence tier**:

- `SOURCE-CONFIRMED` — the defect is established from the pinned source control flow read directly during this review (the file/symbol/lines were inspected, not inferred).
- `STRONG-SOURCE-INFERENCE` — the defect is established from the pinned source control flow plus architectural knowledge of the adjacent callers; verify the exact boundary before claiming it is runtime-reproduced.
- `GITHUB-ACTIONS-CONFIRMED` — established from a CI/runner observation, not source.

`SOURCE-CONFIRMED` here means **source-confirmed**, not that every finding was locally reproduced with a failing test. Do not claim a finding is runtime-reproduced until you run the prescribed test.

### Severity

- **P0 — release blocker / high-impact security or ownership invariant.** Fix before feature work.
- **P1 — major correctness, durability, isolation, or cancellation defect.** Fix in stabilization phases.
- **P2 — important robustness, protocol, UX truthfulness, performance, or parity gap.**
- **Feature gap — intentional capability delta vs. current Kimi; not a correctness defect by itself.**

### New finding counts (this document)

- **P0:** 3
- **P1:** 11
- **P2:** 3
- **Feature gaps:** 9 (not severity-ranked)

### Source anchoring

Line numbers move quickly in this repository. Each new finding includes the pinned commit, the exact file(s)/symbol(s), and an `rg -n` locator. Run the locator against the checked-out commit and record exact line numbers in the implementation notes.

### Execution rules (unchanged from R1, re-stated for convenience)

1. Work from a clean checkout of the intended branch; record `git status --short`, `git rev-parse HEAD`, `node --version`, `npm --version`.
2. If HEAD differs from `ee2bf41d982cc6ca6de6e0a747e74ac8bc19107a`, compare the overlapping files and mark findings `already fixed`, `still present`, or `changed`.
3. Fix invariants before UI/parity work. Do **not** add background tasks, AFK autonomy, richer plugins, or more concurrency while foreground turn ownership/cancellation is unsafe.
4. Add a regression test for every bug fix. A source edit without a failing-before/passing-after test is incomplete unless the behavior cannot reasonably be automated; document that exception.
5. Keep machine-output protocols versioned and stdout clean.
6. Treat persisted session/config paths and shell commands as security boundaries, not convenience helpers.
7. Do not silently repair-and-overwrite corrupt user data.

---

## 1. Reclassification of the Prior 62 Findings

The prior audit enumerated 62 findings (`VCL-001` … `VCL-062`). Re-scanned at `ee2bf41`, the working classification is:

| Status | Count |
|---|---|
| Fixed | 13 |
| Partially fixed | 8 |
| Still present | 41 |

Per-ID status was established by running `scripts/recheck-vcl-findings.mjs` (locator check over all 62 IDs) and re-verifying every flagged discrepancy manually. The counts refine the prior scan's `12/8/42` by exactly one: **`VCL-040` is fixed** — `clearPlan()` validates the plan path through the workspace boundary and has a regression test (`plan-mode.test.ts` line 224, `VCL-040`), which the prior count missed.

### 1.0a Exact per-ID status (all 62)

| ID | Status | Evidence |
|---|---|---|
| VCL-001 | **partial** | frozen per-turn signal exists; ownership still non-atomic → R2-001 |
| VCL-002 | **partial** | signal reaches `chatCompletionStream`; retry/backoff + tool classes still gap → R2-004/005 |
| VCL-003 | **partial** | slash idle gate exists; `/review`/`/init`/keybindings bypass → R2-015 |
| VCL-004 | **partial** | `turnInProgress` mutex exists; entry not atomic → R2-001 |
| VCL-005 | fixed | queue attachment test |
| VCL-006 | fixed | cross-turn leak test |
| VCL-007 | fixed | compaction-preserves-fileContext test |
| VCL-008 | fixed | resume budget test |
| VCL-009 | fixed | chat-only fail-closed path |
| VCL-010 | fixed | `limit_reached` terminal state |
| VCL-011 | fixed | chat continuation persistence |
| VCL-012 | fixed | resume override test |
| VCL-013 | fixed | machine-output headless test |
| VCL-014 | present | agent stdin still unbounded |
| VCL-015 | present | permission-mode normalization incomplete |
| VCL-016 | present | duplicated built-in contract layers |
| VCL-017 | fixed | scoped-rules test |
| VCL-018 | present | `/reload` still overclaims |
| VCL-019 | present | `/config` still inspector (exists, `availability: always`) |
| VCL-020 | present | `/plugins` still no plugin lifecycle |
| VCL-021 | present | `/mcp` lifecycle incomplete |
| VCL-022 | present | skill invocation syntax differs |
| VCL-023 | present | skill precedence still Map-order |
| VCL-024 | present | flat `<name>.md` discovery missing |
| VCL-025 | present | global skill paths inconsistent |
| VCL-026 | present | no AFK mode |
| VCL-027 | present | no `/btw` side-question |
| VCL-028 | present | no `/task` lifecycle |
| VCL-029 | present | startup-only `--add-dir`, no runtime `/add-dir` |
| VCL-030 | present | no thinking on/off separate from effort |
| VCL-031 | present | no print/quiet/ACP/wire contract |
| VCL-032 | present | no max-steps/retry/Ralph surface |
| VCL-033 | present | no plugin subsystem |
| VCL-034 | present | no `/undo` fork UX |
| VCL-035 | present | session semantics differ from Kimi |
| VCL-036 | present | plan-mode parity unverified |
| VCL-037 | fixed | workspace-scoped delete test |
| VCL-038 | present | delta-heavy session rewrites |
| VCL-039 | present | no strict future-version rejection |
| VCL-040 | fixed | test `clearPlan refuses to delete a plan path outside the workspace (VCL-040)` |
| VCL-041 | **partial** | lexical restore path persists → R2-008 |
| VCL-042 | **partial** | parse `catch` still returns `{}` → R2-009 |
| VCL-043 | present | history/usage non-atomic writes |
| VCL-044 | present | corrupt history/usage overwrite |
| VCL-045 | **partial** | no discriminated transport schema → R2-012 |
| VCL-046 | present | `tools/list_changed` startup race |
| VCL-047 | present | stale MCP liveness |
| VCL-048 | present | no fail-fast on disconnected MCP |
| VCL-049 | **partial** | EOF still yields `done:true` → R2-010 |
| VCL-050 | present | line-oriented SSE parsing |
| VCL-051 | present | hard-coded idle timeout |
| VCL-052 | present | stream-json turn correlation |
| VCL-053 | present | no terminal result record |
| VCL-054 | present | tool IDs omitted from protocol |
| VCL-055 | present | per-delta transcript growth |
| VCL-056 | present | math parser comma frames |
| VCL-057 | fixed | raw-shell auto fail-closed (VCL-057 policy) |
| VCL-058 | present | shell child-tree cancellation partial → R2-005 |
| VCL-059 | present | shell timeout bounds |
| VCL-060 | present | `parallel-tool-calls` bool parsing |
| VCL-061 | present | pinned contract ≠ drift detection |
| VCL-062 | present (env) | CI was red at baseline; `verify` green at `ee2bf41` — re-verify per run |


### 1.1 Fixed (13)

These were materially addressed between `61fcefa` and `ee2bf41`; each has a regression test in the tree. Do **not** re-fix these without first re-running the cited test.

| ID | Finding | Fix commit / note |
|---|---|---|
| VCL-005 | Queued/injected `@file` mentions lose their attachment | `b2b2b90`; `PendingUserMessage { text, attachment }` |
| VCL-006 | Per-turn file context leaks into the next queued turn | `b2b2b90`; per-turn `setTurnFileContext` |
| VCL-007 | Compaction erases the active turn's file context | `b2b2b90`; `context.compact()` keeps `fileContext` |
| VCL-008 | Resumed session keeps a zero-token context budget | `b2b2b90`; budget re-applied in `loadState` |
| VCL-009 | Unknown/failed model profile fails open to agent/tool mode | `b2b2b90`; discovery `.catch(() => undefined)` → chat-only |
| VCL-010 | Turn budget exhaustion reported as `complete` | `70afaa1`; `limit_reached` terminal state |
| VCL-011 | `chat --continue` loses the prior assistant answer | `70afaa1`; canonical assistant message appended before persist |
| VCL-012 | Resume overwrites explicit CLI overrides | `70afaa1`; `ResumeOverrides` precedence |
| VCL-013 | `--interactive` can open the TUI with machine output | `ad4db89`; machine formats unconditionally headless |
| VCL-017 | Nested path-scoped rules load globally | `a7adbe1`; scoped rules resolved per-path |
| VCL-037 | Session deletion not scoped to the workspace | `a7adbe1`; `delete(id, expectedWorkspace)` |
| VCL-040 | Plan deletion trusts a persisted plan file path | `clearPlan()` validates through `assertInsideWorkspace`; test at `plan-mode.test.ts` (VCL-040) |
| VCL-057 | Regex shell classification is a fail-open authorization boundary | `819f321`; raw shell never auto-approved in `auto` |

`VCL-062` (the failing CI run at `61fcefa`) is treated as **addressed** — the current `main` runs `npm run verify` green — but it is environmental, so it is not counted in the 13 code fixes above.

### 1.2 Partially fixed (8)

Each of these has a residual defect that is now recorded as a **new finding** in §2. Fix the residual, not the original.

| ID | Original finding | Residual → new finding |
|---|---|---|
| VCL-001 | Cancellation swaps the runtime signal before the turn unwinds | Per-turn signal is frozen, but foreground turn **ownership** is still non-atomic → **R2-001** |
| VCL-002 | AbortSignal not propagated through Runtime → ModelClient → HTTP | Signal reaches `chatCompletionStream`, but retry backoff sleep and several tool classes still ignore it → **R2-004**, **R2-005** |
| VCL-003 | State-mutating slash commands run while a turn is active | A slash gate exists, but `/review`, `/init`, metadata/export, and mode-key bypasses remain → **R2-015** |
| VCL-004 | Direct shell/tool passthrough bypasses turn ownership | A `turnInProgress` mutex exists, but ownership is not atomic at turn entry → **R2-001** |
| VCL-041 | Checkpoint restore bypasses workspace realpath/symlink safety | `restore` is now root-aware but still lexical, not realpath-validated → **R2-008** |
| VCL-042 | Malformed config silently becomes `{}` and can be overwritten | Atomic temp-write was added, but parse-failure still yields `{}` and can be saved over the original → **R2-009** |
| VCL-045 | MCP server entries not deeply schema-validated | Some validation exists, but no strict discriminated per-transport schema and no liveness recheck → **R2-012** |
| VCL-049 | Unexpected SSE EOF accepted as success | Malformed frames now throw, but clean EOF without `[DONE]` still terminates normally → **R2-010** |

### 1.3 Still present (41)

The remaining 41 findings are **still present** in substance at `ee2bf41` and are **not restated here**; the prior document (`VENICE_CLI_EXHAUSTIVE_BUG_AUDIT_AGENT_HANDOFF_2026-08-17.md`) remains the authoritative matrix for those IDs, including their reproduction steps, remediation, and acceptance criteria, and §1.0a above gives the one-line per-ID status.

Notable items that remain open: `VCL-014` (agent stdin bound), `VCL-015` (permission-mode normalization), `VCL-016` (duplicated built-in contract layers), `VCL-018`–`VCL-025` (slash-command truthfulness and skill parity), `VCL-026`–`VCL-035` (Kimi feature gaps), `VCL-038`/`VCL-039` (session durability/schema), `VCL-043`/`VCL-044` (history/usage durability), `VCL-046`–`VCL-048` (MCP lifecycle), `VCL-050`/`VCL-051` (SSE framing/timeouts), `VCL-052`–`VCL-054` (machine protocol), `VCL-055`/`VCL-056` (transcript/math), `VCL-058`–`VCL-061` (shell/protocol tooling), and `VCL-062` (environmental CI re-check). Re-verify each against `ee2bf41` before editing; the repo has moved.

Re-check tooling: `scripts/recheck-vcl-findings.mjs` runs every finding's `rg` locator against the current tree and reports match counts with per-kind interpretation (`bug` vs `parity` vs `env`). It is a locator check, not a semantic re-verification — confirm suspicious rows (`anchor gone`, `SUSPECT REGRESSION`) by running the cited test.

---

## 2. New Findings (pinned `ee2bf41`)

### R2-001 — Foreground turn ownership is non-atomic

**Severity:** P0
**Confidence:** SOURCE-CONFIRMED
**Category:** Turn ownership / concurrency

**Evidence anchor:** `src/agent/runtime.ts` `sendUserMessage()` (line ~744) sets `state.status = 'thinking'` and `await this.start()` **before** `turnInProgress` is set inside `processTurns()` (line ~856). `injectUserMessage()` (line ~316) and `executeDirectTool()` (line ~1256) gate on `turnInProgress`, so they observe a different ownership state than `sendUserMessage` does. The TUI additionally resolves `@file` attachments (`readMentionedFiles`) before it establishes its local running state, widening the window.

```bash
rg -n "sendUserMessage|turnInProgress|injectUserMessage|queueUserMessage|executeDirectTool" src/agent/runtime.ts
rg -n "readMentionedFiles|isRunning|setRunning|onSubmit" src/ui/app.tsx src/ui/composer.tsx
```

**Failure mechanism**

Two concurrent `sendUserMessage()` calls can both pass the entry point before `turnInProgress = true`. Each then sets the file context, appends a user message, and calls `processTurns()`, producing two interleaved turn loops that share one `state`, one `ContextManager`, one `AbortController`, and one queue. The TUI race means a second submit (or an injection) can land while the first turn's `@file` context is still being resolved, so the first turn's attachment can be replaced before it ever reaches the model.

**Reproduction / proof target**

Instrument `sendUserMessage` to `await` a controllable gate immediately after `this.start()`. Fire two submissions, then a `queueUserMessage`/`injectUserMessage`, and assert that the second entry is either rejected or serialized until the first turn's `finally` runs.

**Required remediation**

Introduce a first-class `TurnExecution`/`TurnController` (immutable `AbortController`, `turnId`, state, completion promise) and a single serializing entry point. `sendUserMessage`, `queueUserMessage`, `injectUserMessage`, and `executeDirectTool` must all acquire/observe the same owner **before** any side effect. The TUI must set its busy state before resolving attachments, and derive busy state from the runtime state machine, not a separate UI boolean.

**Regression tests**

Concurrent double-submit, submit+during-`start`, submit+during-attachment-resolution, injection into a starting turn, direct-tool during a starting turn.

**Acceptance criteria**

At most one foreground turn owns the workspace/session/context at any instant; the second submission cannot mutate state until the first turn's `finally` completes.

---

### R2-002 — Cancellation during approval is not a hard barrier

**Severity:** P0
**Confidence:** SOURCE-CONFIRMED
**Category:** Cancellation / approval

**Evidence anchor:** `src/agent/runtime.ts` `runTool()` (line ~1355) `await this.permissions.requestApproval(...)`, then proceeds to emit `tool_started` and execute (line ~1379 onward) **without** re-checking `activeTurnSignal?.aborted`. Same shape in `runValidation()` (line ~1691) and `exitPlanMode` (`requestPlanApproval`, line ~1534). `permissions.requestApproval` (line ~122) is a plain `await this.approver(...)` with no abort composition.

```bash
rg -n "requestApproval|requestPlanApproval|approver|activeTurnSignal\?\.aborted|tool_started" src/agent/runtime.ts src/agent/permissions.ts
```

**Failure mechanism**

The turn loop checks `activeTurnSignal?.aborted` at loop granularity (before the model call, before each tool call in `processToolCalls`). But once an approval promise is pending, Ctrl-C aborts the turn and the `approver` promise remains live. When the user subsequently grants (or a stale TUI prompt resolves), `runTool` resumes past the approval and executes the tool — a side effect after the turn was cancelled. A cancelled turn can therefore still write files, run shell, or invoke MCP/plan state.

**Reproduction / proof target**

Start a turn that requires approval (e.g. `suggest` mode + raw shell). Before answering the approval prompt, cancel the turn, then resolve the approval callback with `approved: true`. Assert the tool never executes and the result records `cancelled`, not `PERMISSION_DENIED`/success.

**Required remediation**

Make the approval promise abort-aware, and/or add a mandatory `if (this.activeTurnSignal?.aborted) { this.state.status = 'cancelled'; return … }` recheck immediately before **every** side-effect boundary after an `await` (post-approval, post-validation-approval, post-plan-approval). Compose the turn signal into the approver so a cancelled turn can never resolve into execution.

**Regression tests**

Cancel-before-approval, cancel-after-approval-resolves, cancel-during-plan-approval, cancel-during-validation-approval, double-abort.

**Acceptance criteria**

A turn that is cancelled cannot execute any tool/validation/plan side effect, regardless of when the cancellation lands relative to a pending approval.

---

### R2-003 — `/new` / resume can inherit previous-session runtime context

**Severity:** P0
**Confidence:** SOURCE-CONFIRMED
**Category:** Session lifecycle / state isolation

**Evidence anchor:** `src/agent/runtime.ts` `loadState()` (line ~626) uses `Object.assign(this.state, state)` and does **not** clear `queuedMessages`/`injectedMessages` (fields declared line ~145–148), nor does it reset the `ContextManager` `summary`, `activeSkills`, `agentPrompt`, or `fileContext` before rebuilding. `ContextManager.resetConversation()` clears conversation only.

```bash
rg -n "Object\.assign\(this\.state|queuedMessages|injectedMessages|resetConversation|setSummary|setAgentPrompt|setActiveSkills|setFileContext" src/agent/runtime.ts src/agent/context.ts
rg -n 'name: "new"|/new|handleNew|reset' src/ui/slash-handlers.ts src/ui/app.tsx
```

**Failure mechanism**

`Object.assign` is a shallow merge: an older session's `modelProfile`, `plan`, `checkpointIndex`, etc. can survive into a session that legitimately lacks those fields. More importantly, the in-memory queue/injection arrays and the ContextManager's layered state (summary, attachment, active skills, agent prompt) are not reset at a `/new` or resume boundary, so a fresh session can start with the previous session's queued messages and prompt layers.

**Reproduction / proof target**

Populate a runtime (queue a message, inject one, activate a skill, set an agent prompt), then invoke `/new` and load a minimal session. Assert the queue is empty, no injected message survives, and the rebuilt context contains no summary/attachment/skill/agent-prompt layer from the prior session.

**Required remediation**

Add an explicit `resetForNewSession()` (or a `TurnExecution` teardown) that clears queue/injection arrays and resets **all** ContextManager layers, and make `loadState` replace (not merge) the `AgentState` with a validated, defaulted copy — absent optional fields become explicit defaults, not leftovers.

**Regression tests**

`/new` after a busy run, resume after queue/inject, minimal session after rich session, and absent-optional-field replacement.

**Acceptance criteria**

A new or resumed session observes exactly the state that was persisted for it — no queued messages, injections, summaries, attachments, skills, or agent prompts bleed across the boundary.

---

### R2-004 — API cancellation fails across retry backoff

**Severity:** P1
**Confidence:** SOURCE-CONFIRMED
**Category:** Cancellation / HTTP retry

**Evidence anchor:** `src/lib/api.ts` `sleep()` (line ~250) is a plain `setTimeout` with no `AbortSignal`; the retry loops (lines ~482–512 and ~1820–1831) call `await sleep(...)` without composing the request signal, and can construct a subsequent attempt against an already-aborted parent.

```bash
rg -n "async function sleep|await sleep|RETRY_DELAY_MS|retryAfter|abortSignal|controller\.abort" src/lib/api.ts
```

**Failure mechanism**

When the user cancels during a `Retry-After`/exponential-backoff sleep, the sleep does not observe the abort and the process blocks until it expires. The next attempt may then be created even though the parent `AbortSignal` is already aborted, restarting network work after the user cancelled.

**Reproduction / proof target**

Mock a `429` with `Retry-After` on a real timer. Cancel the turn during the sleep window and measure how long the request actually takes to unwind and whether a second fetch fires.

**Required remediation**

Make `sleep` abortable (`AbortSignal` + `setTimeout` + `addEventListener('abort')`), compose the request signal into every retry wait, and re-check `signal.aborted` before issuing any subsequent attempt. Abort should win the race with the timer deterministically.

**Regression tests**

Cancel-during-backoff, cancel-during-`Retry-After`, abort-before-retry-attempt, jitter-with-abort, final-attempt-no-sleep.

**Acceptance criteria**

A cancellation interrupts retry/backoff promptly and never spawns a retry against an aborted parent signal.

---

### R2-005 — Cancellation does not cascade through several tool classes

**Severity:** P1
**Confidence:** STRONG-SOURCE-INFERENCE
**Category:** Cancellation / tools

**Evidence anchor:** Subagent spawn (`src/agent/subagents.ts`), Venice media/search tools (`src/tools/venice/*`), and MCP call paths. MCP `callTool(name, args, signal)` (runtime line ~1027/1056) forwards the signal but primarily stops the **local wait**, not the **server-side** tool.

```bash
rg -n "spawn|runSubagent|AbortSignal|signal|callTool|fetch|setTimeout" src/agent/subagents.ts src/tools/venice src/mcp/client.ts
```

**Failure mechanism**

Subagents and Venice-native image/audio/video/search operations do not consistently inherit the active turn signal, so a Ctrl-C can leave a subagent or media request running to completion (and billing for it) after the turn is cancelled. MCP cancellation aborts the local `callTool` promise but does not guarantee the server-side tool stops.

**Reproduction / proof target**

Start a long subagent and a long Venice media operation; cancel the turn; assert both the local promise and the underlying network/child work terminate promptly.

**Required remediation**

Thread `activeTurnSignal` into subagent and every Venice media/search call, and pass it into their underlying `fetch`/timeout controllers. For MCP, document (and, where the transport supports it, implement) cancellation notification to the server; at minimum, guarantee the local wait is abortable and no post-abort result is recorded.

**Regression tests**

Subagent cancel, Venice image/video/audio/search cancel, MCP local-cancel, MCP server-side behavior documented.

**Acceptance criteria**

No tool class continues producing side effects or billing after the owning turn is cancelled.

---

### R2-006 — Same-turn injection can destroy the original `@file` context

**Severity:** P1
**Confidence:** SOURCE-CONFIRMED
**Category:** Context / injection

**Evidence anchor:** `src/agent/runtime.ts` `processTurns()` injection branch (line ~883–891) calls `this.setTurnFileContext(injected.attachment)` for every injected message. `setTurnFileContext` (line ~787) clears the ambient file context when `attachment` is undefined.

```bash
rg -n "injectedMessages|setTurnFileContext|setFileContext" src/agent/runtime.ts src/agent/context.ts
```

**Failure mechanism**

A turn that started with a real `@file` attachment sets the file-context layer. If a plain (attachment-less) message is injected into the same turn, the injection branch calls `setTurnFileContext(undefined)`, which **clears** the original turn's attachment. The next model step loses the source file the user attached.

**Reproduction / proof target**

Start turn A with `@src/foo.ts`, inject a plain message mid-turn, and assert the next model request still contains `foo.ts` content.

**Required remediation**

Attachments must be scoped to the **turn owner**, not ambient runtime state. An injected message without an attachment must not mutate the owning turn's file context. Track per-message attachment provenance so injection can add its own context without erasing the turn's.

**Regression tests**

Injection-with-attachment, injection-without-attachment into an attached turn, multiple injections, and queued-then-injected ordering.

**Acceptance criteria**

A plain injected message never removes the original turn's attachment; only an explicit attachment-carrying message can change it.

---

### R2-007 — Compaction is not durable

**Severity:** P1
**Confidence:** SOURCE-CONFIRMED
**Category:** Context / durability

**Evidence anchor:** `src/agent/context.ts` `compact()` (line ~207) trims only the private `conversation` array; the persisted `AgentState.messages` is never trimmed. `src/agent/runtime.ts` `loadState()` (line ~695) calls `context.resetConversation()` then re-adds **every** `state.messages`.

```bash
rg -n "compact\(|this\.conversation|resetConversation|addConversationMessage|state\.messages|persist\(" src/agent/context.ts src/agent/runtime.ts
```

**Failure mechanism**

`compact()` rewrites the in-memory context to `summary + recent turns`, but the on-disk session still holds the full pre-compaction history. On resume, `loadState` reconstructs the complete history and discards the compacted/summarized form, so the effective context the model saw before compaction is lost and replaced with the un-compacted history.

**Reproduction / proof target**

Run a session past the compaction threshold, persist, resume, and compare the rebuilt context length/contents against the compacted state before shutdown.

**Required remediation**

Persist the compaction outcome: either persist the compacted `messages` (plus the summary) so resume reconstructs the same effective context, or persist an explicit compaction marker/summary that `loadState` re-applies instead of replaying the full history. Define which is canonical and test it.

**Regression tests**

Compaction→persist→resume round-trip, compaction near threshold, compaction with active attachment, resumed session that never compacted.

**Acceptance criteria**

The context a resumed session builds is semantically identical to the context the session had at persist time (compacted or not).

---

### R2-008 — Checkpoint restore remains symlink-unsafe

**Severity:** P1
**Confidence:** SOURCE-CONFIRMED
**Category:** Filesystem security

**Evidence anchor:** `src/agent/checkpoints.ts` `restore()` (line ~126) builds `const absolute = path.resolve(root, relativePath)` then `fs.writeFileSync(absolute, content)` (line ~147). This is lexical containment; it does not route through `WorkspaceManager.resolve()` realpath/symlink revalidation (which exists at `src/agent/workspace.ts` line ~75/133–150).

```bash
rg -n "restore\(|path\.resolve|writeFileSync|realpath|rootId|allowedRoots" src/agent/checkpoints.ts src/agent/workspace.ts
```

**Failure mechanism**

A directory that was inside the workspace at checkpoint time can be replaced by a symlink to an external path before restore. Because restore writes to the lexical path without re-resolving realpaths, it can create/overwrite a file outside the workspace.

**Reproduction / proof target**

Checkpoint `dir/file`, replace `dir` with a symlink to an external temp dir, restore, and assert the external file was not written.

**Required remediation**

Route every restore target through the `WorkspaceManager` realpath-aware resolver immediately before the write (deepest-existing-ancestor realpath + parent boundary validation). Refuse symlink traversal; re-validate the parent after resolution.

**Regression tests**

Symlink swap/TOCTOU, nested symlink, deleted parent, additional-root restore, legacy (no-rootId) restore.

**Acceptance criteria**

Checkpoint restore cannot create/overwrite a file outside an approved workspace root, even if the directory was swapped to a symlink after checkpoint creation.

---

### R2-009 — Malformed config remains a data-loss path

**Severity:** P1
**Confidence:** SOURCE-CONFIRMED
**Category:** Configuration durability

**Evidence anchor:** `src/lib/config.ts` `loadConfig()` (line ~70) returns `{}` when the file is missing (line ~73) and returns `{}` from the parse `catch` (line ~91–94). A subsequent `config set` mutates the loaded object and saves it over the original, erasing the corrupt file.

```bash
rg -n "loadConfig|JSON\.parse|catch|return \{\}|saveConfig|setConfigValue|writeFileSync" src/lib/config.ts src/commands/config.ts
```

**Failure mechanism**

Atomic temp-write/rename was added, but the **read** side still collapses parse failure to an empty object. A corrupt `~/.venice/config.json` becomes `{}` in memory; the next mutation writes `{}` + one field over the corrupted original, silently discarding API/auth/settings data that may still be recoverable.

**Reproduction / proof target**

Back up config, write malformed JSON, run a harmless `config set`, and assert the malformed original is preserved (or a backup/quarantine is created) rather than overwritten.

**Required remediation**

Split tolerant read-for-display from strict read-for-mutation. Mutation must fail fast on parse error and refuse to write until the user recovers. On first detection of corruption, create a timestamped backup/quarantine and surface a precise error. Never save over an unreadable source.

**Regression tests**

Malformed JSON, permission error, interrupted write, schema-invalid JSON, backup/quarantine creation, read-only vs. mutating read.

**Acceptance criteria**

No config mutation can overwrite an unreadable/corrupt source without explicit recovery; corruption is always surfaced and preserved.

---

### R2-010 — SSE truncation remains accepted as success

**Severity:** P1
**Confidence:** SOURCE-CONFIRMED
**Category:** Streaming correctness

**Evidence anchor:** `src/lib/api.ts` `chatCompletionStream()` (line ~700) is line-oriented (`buffer.split('\n')`), treats each `data:` line as a complete event rather than assembling multi-line SSE event frames, and on loop exit (line ~852) yields `{ done: true, … }` **unconditionally** — including when EOF arrived without `[DONE]` or any `finish_reason`.

```bash
rg -n "chatCompletionStream|buffer\.split|\[DONE\]|done: true|finish_reason|yield \{ done" src/lib/api.ts src/agent/model-client.ts
```

**Failure mechanism**

A proxy/network truncation that closes after a few deltas, with no `[DONE]` and no finish reason, falls through to `yield { done: true }` and is reported as a normal terminal stream. Partial/empty answers become "successful" completions. The line-oriented parser also mishandles multi-line `data:` events and a `[DONE]` split across chunk boundaries.

**Reproduction / proof target**

Mock an SSE response that sends a couple of deltas and closes without `[DONE]`; assert the generator either throws `STREAM_TRUNCATED` or yields an explicit incomplete terminal — never a plain `done: true`.

**Required remediation**

Track clean protocol completion explicitly. Unexpected EOF before a valid terminal event must throw `STREAM_TRUNCATED` (retry only when safe and before any externally visible side effect). Assemble complete SSE event frames (respect `event:`/`data:`/multi-line `data` and cross-chunk boundaries) rather than line-splitting.

**Regression tests**

Clean `[DONE]`, finish reason only, empty EOF, partial-JSON EOF, partial-text EOF, split `[DONE]` across chunks, multi-line `data`, abort, idle timeout.

**Acceptance criteria**

Transport truncation can never be reported as a successful model completion; only a valid protocol terminal counts as success.

---

### R2-011 — Machine JSONL is semantically incomplete

**Severity:** P1
**Confidence:** SOURCE-CONFIRMED
**Category:** Machine-output protocol

**Evidence anchor:** `src/agent/stream-json.ts` `toStreamJson()` has **no case** for `assistant_complete` or `assistant_error` (both emitted by `runtime.ts` at lines ~918 and ~963), so they hit `default: return undefined` and are dropped. `tool.completed` data is `{ tool, result }` with no stable `toolCallId`. `session.completed` data is `{ status }` only — no final output, usage, or incomplete reason. `turnId` in the envelope is a single `StreamJsonContext.turnId`, not per-turn.

```bash
rg -n "assistant_complete|assistant_error|assistant_delta|tool\.completed|session\.completed|toolCallId|turnId" src/agent/stream-json.ts src/agent/events.ts src/agent/runtime.ts
```

**Failure mechanism**

A JSONL consumer cannot reliably: correlate deltas/tool calls to a turn (single context `turnId`), know when a turn/assistant message completed or errored (those events vanish), map a tool result back to its `toolCallId`, or read a single authoritative terminal result (final text, usage, incomplete reason). The protocol is usable for a demo but not for a robust client.

**Reproduction / proof target**

Run a tool-using and a plain turn with `--output-format stream-json`; pipe to a strict consumer and assert `assistant.completed`/`assistant.error`, per-turn `turnId`, `toolCallId` on `tool.completed`, and an authoritative terminal event carrying final output/usage/reason.

**Required remediation**

Extend the envelope/event mapping: emit `assistant.completed` and `assistant.error`, carry the stable `toolCallId` through `tool.started`/`tool.completed`, update `turnId` per turn (derived from the event, not a single context field), and add one authoritative terminal event (`run.completed` / `run.failed` / `run.limit_reached` / `run.cancelled`) with final message, usage, and incomplete reason. Bump `PROTOCOL_SCHEMA_VERSION` accordingly.

**Regression tests**

Golden JSONL fixtures for plain/tool/error/limit/cancel turns; assert correlation IDs, terminal event, and schema version.

**Acceptance criteria**

Every turn has a stable correlation ID; every assistant message and every tool call has a start+terminal event carrying its IDs; the stream ends in exactly one authoritative terminal event with final output/error/usage/incomplete reason.

---

### R2-012 — MCP remains under-hardened

**Severity:** P1
**Confidence:** STRONG-SOURCE-INFERENCE
**Category:** MCP robustness

**Evidence anchor:** `src/mcp/config.ts`, `src/mcp/manager.ts`, `src/mcp/client.ts` — server entries need strict discriminated per-transport validation; an early `tools/list_changed` can race registration; manager liveness can go stale; interpreter-based trust fingerprinting does not reliably prove the exact workspace-controlled script executed.

```bash
rg -n "mcpServers|transport|command|url|validate|tools/list_changed|setToolsChangedHandler|isRunning|pid|fingerprint|interpreter" src/mcp
```

**Failure mechanism**

A malformed entry can fail mid-startup and degrade unrelated servers; a `tools/list_changed` that fires before the manager finishes registering can leave a stale/mixed namespace; the manager's `isRunning` can report stale liveness after a crash; and trusting a fingerprint of an interpreter command (rather than the resolved script path) can allow a swapped script to run under a previously-trusted identity.

**Reproduction / proof target**

Feed a schema table of invalid entries; fire `tools/list_changed` immediately at startup; kill a server process and read manager liveness; swap a referenced script and re-check trust.

**Required remediation**

Strict discriminated validation per transport with per-server isolation and actionable diagnostics; sequence `tools/list_changed` against registration; recompute liveness from the actual process/pipe state; fingerprint the **resolved workspace-controlled script** (realpath + content hash), not the interpreter string.

**Regression tests**

Transport schema table, startup race, liveness-after-crash, script-swap trust, interpreter variants.

**Acceptance criteria**

Invalid MCP config never crashes unrelated servers; `tools/list_changed` cannot race registration; liveness reflects the real process; trust proves the exact script executed.

---

### R2-013 — Filesystem mutation / checkpoint ordering is inconsistent

**Severity:** P1
**Confidence:** STRONG-SOURCE-INFERENCE
**Category:** Durability ordering

**Evidence anchor:** `src/tools/filesystem/write.ts` (and edit/patch variants) vs. `src/agent/checkpoints.ts` / runtime checkpoint invocation order. `write_file` can modify disk and then fail checkpoint persistence; edit/patch can checkpoint before a write that subsequently fails.

```bash
rg -n "checkpoint|writeFileSync|snapshot|checkpointIndex|persist|write_file|edit_file|apply_patch" src/tools/filesystem src/agent/checkpoints.ts src/agent/runtime.ts
```

**Failure mechanism**

The mutation-vs-checkpoint ordering differs per tool: some tools write first then checkpoint (leaving disk mutated but the checkpoint missing if persistence fails), others checkpoint first then write (leaving a checkpoint of a write that never landed). Either way, undo/redo and session persistence can diverge from the actual on-disk state.

**Reproduction / proof target**

Force a checkpoint persistence failure on a `write_file` and an `edit_file`; compare the on-disk state vs. the recorded checkpoint.

**Required remediation**

Define one canonical order: checkpoint-before-mutate with rollback, or mutate-before-checkpoint with a compensating restore. Apply it uniformly across write/edit/patch. On any persistence failure, leave disk and checkpoint in a consistent, surfaced state.

**Regression tests**

Write/edit/patch success and failure, checkpoint-persist failure, undo after failed checkpoint, cross-tool consistency.

**Acceptance criteria**

After any tool call, disk state and checkpoint state are consistent, and a persistence failure is surfaced rather than silently diverging.

---

### R2-014 — `venice init` needs symlink containment hardening

**Severity:** P1
**Confidence:** STRONG-SOURCE-INFERENCE
**Category:** Filesystem security / scaffolding

**Evidence anchor:** `src/commands/init.ts` (or the init scaffolding path) writes `.venice/config.json`, `.venice/instructions.md`, `.venice/mcp.json`, and `.venice/skills/` under the workspace without routing the target through the workspace manager's realpath/symlink revalidation.

```bash
rg -n "init|\.venice|mkdirSync|writeFileSync|scaffold|config\.json|instructions\.md" src/commands/init.ts src/agent/workspace.ts
```

**Failure mechanism**

A repository-controlled `.venice` symlink (or a symlinked `.venice/skills` subdir) can redirect scaffolding writes outside the intended workspace.

**Reproduction / proof target**

Create a `.venice` symlink pointing outside the workspace, run `venice init`, and assert no file is written outside the workspace.

**Required remediation**

Route all `init` write targets through the realpath-aware workspace resolver and refuse symlinked destinations (or re-resolve the deepest existing ancestor before writing).

**Regression tests**

`.venice` symlink, `.venice/skills` symlink, clean init, init over existing partial scaffold.

**Acceptance criteria**

`venice init` cannot write outside the workspace, even with a repository-controlled symlink in place.

---

### R2-015 — TUI ownership holes remain despite the slash gate

**Severity:** P2
**Confidence:** STRONG-SOURCE-INFERENCE
**Category:** TUI ownership / slash commands

**Evidence anchor:** `src/ui/slash-commands.ts`, `src/ui/slash-handlers.ts`, `src/ui/app.tsx`. `/review` can launch a subagent while busy, `/init` can write while busy, metadata/export operations remain always available, and Shift-Tab/Ctrl-X mode changes bypass slash-command gating.

```bash
rg -n 'name: "(review|init|export|import|model|theme|skill)"|isRunning|slash|handleSlashCommand|onKey|Shift|Ctrl-X|operatingMode' src/ui/slash-commands.ts src/ui/slash-handlers.ts src/ui/app.tsx src/ui/composer.tsx
```

**Failure mechanism**

The central idle gate protects some mutating commands but not `/review` (subagent spawn), `/init` (writes), metadata/export (session reads while state mutates), or the mode-change keybindings. These can overlap an active turn and read/write inconsistent state.

**Reproduction / proof target**

Start a slow turn and invoke `/review`, `/init`, an export, and the Shift-Tab/Ctrl-X mode change before it completes; assert each is either queued to a turn boundary or rejected.

**Required remediation**

Classify every slash command and keybinding centrally as `READ_ONLY_ALWAYS`, `INTERRUPT`, `QUEUE_BOUNDARY`, or `IDLE_ONLY_MUTATION`, and enforce the classification in one place (including keybindings). Handlers must not duplicate ad-hoc busy checks.

**Regression tests**

Table-driven test for every slash command and keybinding in idle/streaming/tool-running/cancelling/failed states.

**Acceptance criteria**

No slash command or keybinding can change session/model/context/permission state (or spawn a subagent) beneath an active turn.

---

### R2-016 — Attachment ingestion has no aggregate context limit

**Severity:** P2
**Confidence:** SOURCE-CONFIRMED
**Category:** Input robustness / context

**Evidence anchor:** `src/ui/mentions.ts` `readMentionedFiles()` concatenates all accepted files; only a per-file limit is applied, not an aggregate cap across files.

```bash
rg -n "readMentionedFiles|maxBytes|limit|concat|push|join" src/ui/mentions.ts
```

**Failure mechanism**

A user can attach many individually-valid files whose combined size exceeds the model context, inflating memory and context usage with no aggregate guard.

**Reproduction / proof target**

Attach N files each just under the per-file limit and observe the combined payload size.

**Required remediation**

Add an aggregate byte/context budget across all attachments in a turn, truncate or reject with a precise error when exceeded, and surface the total attachment size in the status/debug output.

**Regression tests**

Single-file under/over limit, aggregate under/over limit, mixed sizes, empty file, deleted-after-enqueue.

**Acceptance criteria**

The total attachment payload for a turn never exceeds a documented aggregate budget, and exceeding it fails with an actionable error rather than silently inflating context.

---

### R2-017 — Skill / Kimi parity remains substantially unfinished

**Severity:** P2
**Confidence:** SOURCE-CONFIRMED
**Category:** Skills parity

**Evidence anchor:** `src/skills/registry.ts` discovery order and `Map.set()` collision behavior; `src/ui/slash-handlers.ts` `/skill` parsing. Current Kimi precedence is **Project > User > Extra > Built-in**, and Kimi supports both flat `<name>.md` and directory skill formats.

```bash
rg -n "discover|global|project|extra|Map|set\(|/skill|skillName|\.md" src/skills/registry.ts src/ui/slash-handlers.ts src/ui/slash-commands.ts
```

**Failure mechanism**

Same-name skill precedence can be wrong (later map writes override project with extra/global), flat `<name>.md` discovery is missing, global skill paths are inconsistent, and `/skill:<name> [task]` semantics are not implemented (Venice uses `/skill name` without cleanly separating identifier from task text).

**Reproduction / proof target**

Define `foo` in project, user, and extra roots with distinct markers; inspect which wins. Try `/skill:git-commits fix login race`.

**Required remediation**

Encode scope as data and resolve with an explicit comparator (Project > User > Extra > Built-in), support flat `<name>.md` discovery, unify global paths, and implement canonical `/skill:<name> [task]` (with `/skill <name> [task]` as a compatibility alias). Emit collision diagnostics in verbose/doctor output.

**Regression tests**

Every pairwise scope collision, flat vs. directory format, path variants, `/skill:<name>` vs. `/skill <name>`, Unicode/unknown-skill cases.

**Acceptance criteria**

Skill precedence matches Kimi, flat skill files are discoverable, and `/skill:<name> [task]` invokes a skill with trailing task text.

---

## 3. Feature Parity Gaps (not severity-ranked)

These are intentional capability deltas vs. current Kimi. They are **not** correctness defects, but they are the visible "still missing" surface a parity review would flag. Implement only after the §2 invariants are fixed (see execution rule 4).

1. **AFK** — no idle/away autonomy mode.
2. **`/btw`** — no mid-run "by the way" note that re-prompts without restarting the turn.
3. **`/task`** — no background task lifecycle (spawn/list/attach/cancel).
4. **Runtime `/add-dir`** — `--add-dir` exists at startup, but no in-session add/remove of additional roots.
5. **Independent thinking on/off** — no per-turn toggle for reasoning output independent of model.
6. **`/undo` turn branching** — no branching/rollback of a single turn beyond checkpoint undo.
7. **Max-step / retry / Ralph controls** — no exposed knobs for step budgets, retry policy, or "Ralph"-style autonomous guardrails.
8. **True plugins** — no plugin manifest/install/enable/disable lifecycle (current `/plugins` reports skills/MCP state).
9. **print/quiet/ACP/wire compatibility** — no `--print`, `--quiet`, ACP, or wire-protocol transport parity.

---

## 4. Phased Implementation Order

Follow this order strictly; each phase must pass `CI=true npm run verify` before the next begins.

### Phase 0 — Baseline (mandatory, re-verify)
```bash
npm ci
npm run lint
npm run typecheck      # exists: "tsc --noEmit" (was missing in the prior audit; now fixed and wired into `verify`)
npm run build
npm run test:compiled
npm run test:security
npm run completions:check
npm run api:contract
npm audit --omit=dev
npm run pack:check
npm run verify
```

### Phase 1 — P0 invariants (do not ship features before these)
- R2-001 (atomic turn ownership) and R2-002 (cancellation-after-approval barrier) together — they share the `TurnExecution` abstraction.
- R2-003 (`/new`/resume state isolation).

### Phase 2 — P1 cancellation & durability
- R2-004 (retry/backoff abort), R2-005 (tool cascade), R2-006 (injection attachment).
- R2-007 (durable compaction), R2-008 (checkpoint symlink), R2-009 (config data-loss), R2-013 (mutation/checkpoint ordering).

### Phase 3 — P1 protocol & MCP
- R2-010 (SSE truncation), R2-011 (JSONL semantics), R2-012 (MCP hardening).

### Phase 4 — P1 scaffolding & P2
- R2-014 (`venice init` symlink), R2-015 (TUI ownership holes), R2-016 (aggregate attachment limit), R2-017 (skill parity).

### Phase 5 — Feature gaps
- Only after all P0–P2 are green, and only the gaps the user actually requests.

---

## 5. Test Plan

Every fix ships with a regression test; the acceptance criteria in §2 define the assertion. Summary of new test coverage required:

| Area | Test files | Coverage |
|---|---|---|
| Turn ownership/cancellation | `src/agent/runtime.test.ts` | double-submit, cancel-before/after-approval, queue/inject boundaries |
| Session isolation | `src/agent/session-lifecycle.test.ts` | `/new` and resume with queued/injected/skill/agent-prompt state |
| HTTP retry/cancel | `src/lib/api.test.ts`, `src/lib/api.stream.test.ts` | backoff/Retry-After abort, SSE truncation, frame assembly |
| Tools cascade | `src/agent/subagents.test.ts`, `src/tools/venice/*.test.ts`, `src/mcp/*.test.ts` | subagent/media/MCP cancellation |
| Durability | `src/agent/context.test.ts`, `src/agent/checkpoints.test.ts`, `src/lib/config.test.ts` | compaction round-trip, checkpoint symlink, config corruption |
| Protocol | `src/agent/stream-json.test.ts` (or equivalent) | JSONL golden fixtures, correlation IDs, terminal event |
| Scaffolding | `src/commands/init.test.ts` | `.venice` symlink containment |
| TUI/skills | `src/ui/slash-handlers.test.ts`, `src/skills/*.test.ts`, `src/ui/mentions.test.ts` | command gating, precedence, aggregate attachment |

**Security-focused tests** live in `*.security.test.ts` files and run via `npm run test:security`; keep checkpoint-symlink and config-corruption tests there.

---

## 6. Acceptance Criteria (rollup)

1. **Single owner:** at most one foreground turn owns workspace/session/context at a time; a cancelled turn can never execute a side effect (including after a pending approval resolves).
2. **Clean boundaries:** `/new`, resume, and session load observe exactly the persisted state; no queue/injection/summary/attachment/skill/agent-prompt layer bleeds across.
3. **Deterministic cancellation:** Ctrl-C aborts the model request, retry/backoff, subagents, media/search, and MCP waits promptly and never spawns work against an aborted signal.
4. **Durable context:** compaction and checkpoint state survive persist→resume identically; disk and checkpoint state never diverge after a tool call.
5. **Safe persistence:** checkpoint restore and `venice init` cannot escape the workspace (realpath + symlink revalidation); malformed config is surfaced and preserved, never silently overwritten.
6. **Correct streaming:** transport truncation is an error, never success; the machine JSONL has stable correlation IDs, an authoritative terminal result, and per-turn `turnId`.
7. **Honest surfaces:** every slash command/keybinding is gated; skill precedence and `/skill:<name> [task]` match Kimi.
8. **Green gate:** every phase passes `CI=true npm run verify` with all security tests, completions, api:contract, audit, and pack:check clean.

---

## 7. Known Limitations of This Report

- The full ~100-finding regression matrix (prior 62 + new 18 + feature gaps) is split across two documents: the prior `VENICE_CLI_EXHAUSTIVE_BUG_AUDIT_AGENT_HANDOFF_2026-08-17.md` (authoritative for the 62 original IDs) and this R2 document (authoritative for the 18 new IDs and the reclassification). Keep both open when implementing.
- Confidence tiers distinguish source-confirmed from inferred findings; `STRONG-SOURCE-INFERENCE` items (R2-005, R2-012, R2-013, R2-014, R2-015) should have their exact boundary re-verified with the cited locator before implementation.
- No downloadable archive/bundle accompanies this Markdown; this file **is** the artifact. If a zipped bundle (reproduction fixtures + scripts) is still required, that remains outstanding and must be produced separately.
- Line numbers are point-in-time; always re-run the `rg` locators at the commit you actually modify.
