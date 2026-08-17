# Venice CLI — Live Exhaustive Bug Hunt + Kimi Code Parity Agent Handoff
## Revision 3 — 2026-08-16

Repository: `https://github.com/spearchucker667/venice-cli`  
Audited branch: `main`  
Pinned live commit: `db9e425c72dea49ec8161c2022c5d57a44b5c112`  
Package at audited head: `@spearchucker667/venice-cli@2.1.0`

---

# 0. Mission

This document is an implementation work order for the current live Venice CLI repository.

The objectives are:

1. eliminate confirmed security, correctness, portability, state-management, and protocol defects;
2. make the current agent runtime coherent across CLI, TUI, permissions, workspace roots, sessions, checkpoints, MCP, Skills, streaming output, and direct Venice API calls;
3. close Kimi Code CLI workflow gaps where Kimi-like behavior is the intended product direction;
4. preserve Venice-native capabilities rather than reducing the CLI to a Kimi clone;
5. turn the current test suite into a behavior-level release gate rather than a collection of structural checks.

Do **not** blindly apply the prior handoff. A large set of previously reported defects has been fixed in commits after the earlier audit. This handoff explicitly separates:

- newly confirmed/open defects;
- incomplete Kimi parity;
- intentional product divergences;
- prior findings that are now verified fixed.

The implementation standard is:

> A feature is complete only when it works through parsing, runtime state, permission enforcement, persistence/resume, TUI, machine output, cancellation, cross-platform behavior, and regression tests.

---

# 1. Audit Baseline

## 1.1 Live commit

```text
db9e425c72dea49ec8161c2022c5d57a44b5c112
```

Latest relevant commits before this head include:

```text
db9e425  feat: brand greeting, debug zip export, and session import fixes
4336ff4  security/remediation work
0d16162  Kimi-style interaction and agent UX remediation
53bf98d  earlier modes/session milestone
```

If `main` moves before implementation starts, the agent MUST repeat:

```bash
git fetch origin
git rev-parse origin/main
git log -8 --oneline --decorate
```

and reconcile this handoff against the new head.

---

# 2. Exact-Head CI Status

The exact audited commit is **not green**.

GitHub Actions run:

```text
run: #19
run id: 31978349955
head: db9e425c72dea49ec8161c2022c5d57a44b5c112
result: failure
```

The matrix currently runs:

```text
Quality: Linux / Node 22
Platform: Linux / macOS / Windows / Node 22
Runtime: Linux / Node 18 / Node 20 / Node 22
```

The same compiled suite is failing across the matrix.

### Linux/macOS/runtime failure

Test:

```text
brand display policy
  resetGreetingPolicyCache re-reads the environment for each resolution
```

Root cause:

- the test forces `process.stdout.isTTY = true`;
- sets `COLORTERM=truecolor`;
- deletes `VENICE_NO_ANIMATION`;
- but leaves CI's real `CI=true` environment variable intact;
- production `resolveGreetingPolicy()` correctly reads `process.env.CI`;
- therefore animation remains disabled and the test's expected `true` is invalid under CI.

This is a **non-hermetic test**, not evidence that production should animate in CI.

### Additional Windows failure

Test:

```text
SkillRegistry discovery errors
  surfaces unreadable skill files
```

The test uses:

```ts
fs.chmodSync(skillPath, 0o000);
```

and assumes that makes the file unreadable.

That assumption is not portable to Windows ACL semantics.

### Required action

Fix the fixtures, not production behavior.

For the greeting test, snapshot and explicitly set/clear every environment variable used by the unit:

```ts
const previous = {
  CI: process.env.CI,
  TERM: process.env.TERM,
  COLORTERM: process.env.COLORTERM,
  COLORFGBG: process.env.COLORFGBG,
  VENICE_NO_ANIMATION: process.env.VENICE_NO_ANIMATION,
};
```

Then make the test define its own complete environment.

For unreadable file handling, prefer dependency injection:

```ts
interface SkillFs {
  readFileSync: typeof fs.readFileSync;
  readdirSync: typeof fs.readdirSync;
}
```

and inject a read failure. If preserving a filesystem-level test, guard it to POSIX and keep a platform-neutral unit test for the error path.

---

# 3. Current Source-of-Truth References

## Venice

```text
https://github.com/veniceai/api-docs
https://docs.venice.ai/swagger.yaml
https://docs.venice.ai/api-reference/endpoint/chat/completions
https://docs.venice.ai/api-reference/endpoint/models/traits
https://docs.venice.ai/api-reference/endpoint/models/compatibility_mapping
```

## Kimi Code

```text
https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-command.html
https://www.kimi.com/code/docs/en/kimi-code-cli/reference/slash-commands.html
https://www.kimi.com/code/docs/en/kimi-code-cli/reference/tools.html
https://www.kimi.com/code/docs/en/kimi-code-cli/guides/interaction.html
https://www.kimi.com/code/docs/en/kimi-code-cli/customization/agents.html
https://www.kimi.com/code/docs/en/kimi-code-cli/customization/skills.html
https://www.kimi.com/code/docs/en/kimi-code-cli/customization/hooks.html
https://www.kimi.com/code/docs/en/kimi-code-cli/customization/plugins.html
https://github.com/MoonshotAI/kimi-code
```

## MCP

```text
https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle
https://modelcontextprotocol.io/specification/2025-06-18/server/tools
https://modelcontextprotocol.io/specification/2025-06-18/server/resources
https://modelcontextprotocol.io/specification/2025-06-18/server/prompts
```

---

# 4. What the New Remediation Successfully Fixed

Do not reopen these unless a reproduction contradicts the current code/tests.

The current head substantially fixes the previous audit's following items:

- project MCP configuration now has a trust gate;
- untrusted project MCP is skipped in noninteractive mode;
- MCP environment inheritance is sanitized;
- permission grants carry risk ceilings;
- destructive risk escalation no longer inherits a generic lower-risk grant;
- direct Shell Mode routes through runtime authorization rather than duplicating permission logic in the UI;
- Plan mode accepts ordinary user prompts;
- Plan-safe tools are explicitly declared;
- Plan restrictions are also checked at runtime execution;
- checkpoint undo/redo are not exposed as Plan-safe loopholes;
- Plan mode has a dedicated plan artifact and explicit enter/exit tools;
- Plan exit approval is separate and is not bypassed by YOLO;
- resumed prompts append the new prompt instead of replaying the old session objective;
- permission-mode synchronization on resume is substantially improved;
- session fork is durable before switching;
- session import collision handling, `--force`, `--fork`, and future schema rejection were added;
- JSON session export exists for round-trip import;
- debug ZIP export was implemented;
- x402 header construction is centralized;
- `signInWithX` is now recognized by config and masked as secret material;
- Retry-After supports HTTP-date and the final 429 attempt no longer sleeps unnecessarily;
- embeddings base64 handling and option validation improved;
- model pricing helpers were updated;
- shell stdout/stderr accumulation is bounded;
- POSIX process-tree timeout cleanup improved;
- MCP frame buffering is bounded;
- malformed MCP configuration is surfaced rather than silently treated as empty in the hardened paths;
- Skill discovery errors are surfaced;
- repeatable `--add-dir` and `--skills-dir` flags exist;
- unknown slash commands can fall through to the model;
- slash-command availability is enforced;
- `/clear` now represents a fresh session and `/clear-ui` is explicit;
- `/compact <hint>` is supported;
- `@file` completion gained Git-aware matching;
- composer history gained persistence;
- queued/injected user messages were added;
- AskUser now has a real user-interaction path;
- `--auto` and `--yolo` startup shorthands exist;
- package update identity is read from `package.json`;
- `doctor` is materially more structured than the previous placeholder version.

---

# 5. Open Findings Index

## P0

| ID | Finding |
|---|---|
| VCL-R3-001 | Headless `auto-edit` can auto-execute repository-controlled validation scripts after an edit |

## P1

| ID | Finding |
|---|---|
| VCL-R3-002 | Exact current head is red across the GitHub Actions matrix |
| VCL-R3-003 | Multi-root checkpoints restore files under the wrong root |
| VCL-R3-004 | Multi-root changed-file identity collapses additional roots into primary-root-relative paths |
| VCL-R3-005 | Tool JSON Schema is advertised but not enforced before risk/execution |
| VCL-R3-006 | Model capability discovery still fails open into agent/tool mode |
| VCL-R3-007 | `-p/--prompt` can open the TUI despite being documented as noninteractive |
| VCL-R3-008 | `--output-format json` can open the TUI instead of machine mode |
| VCL-R3-009 | Session import is structurally lossy |
| VCL-R3-010 | Generated `.venice/config.json` is not consumed by the runtime |
| VCL-R3-011 | `stream-json` omits key lifecycle/correlation data |
| VCL-R3-012 | Agent runtime uses non-streaming model completion |
| VCL-R3-013 | MCP `tools/list` pagination is not implemented |
| VCL-R3-014 | MCP tool-list change notifications are ignored |
| VCL-R3-015 | MCP initialization silently accepts missing `protocolVersion` |
| VCL-R3-016 | MCP logical tool errors are reported as successful Venice tools |
| VCL-R3-017 | Workspace MCP trust fingerprints config bytes, not executable provenance/content |
| VCL-R3-018 | Current Venice Chat Completions request surface is still incomplete |

## P2

| ID | Finding |
|---|---|
| VCL-R3-019 | MCP supports only the 2024-11-05 protocol revision |
| VCL-R3-020 | MCP server startup is serial |
| VCL-R3-021 | MCP tool metadata drops current protocol fields/semantics |
| VCL-R3-022 | `parallelSafe` exists but tool calls are serial |
| VCL-R3-023 | Additional-root edits auto-validate only the primary repository |
| VCL-R3-024 | Plan changed-file tracking is not root-aware |
| VCL-R3-025 | Existing persisted Plan path is not revalidated before write |
| VCL-R3-026 | Imported complex arrays are cast rather than structurally validated |
| VCL-R3-027 | Model profile/context discovery can block on live network |
| VCL-R3-028 | Unknown model context fallback assumes 128K |
| VCL-R3-029 | Kimi startup conflict rules are not matched |
| VCL-R3-030 | `--skills-dir` semantics differ from current Kimi |
| VCL-R3-031 | `--agent` / `--agent-file` missing |
| VCL-R3-032 | Active Skills are not slash commands |
| VCL-R3-033 | Prompt/context `/undo` missing |
| VCL-R3-034 | `/reload` / `/reload-tui` missing |
| VCL-R3-035 | `/copy` missing |
| VCL-R3-036 | Live `/add-dir` management missing |
| VCL-R3-037 | Background shell task system and `/tasks` missing |
| VCL-R3-038 | `/btw` missing |
| VCL-R3-039 | Goal mode missing |
| VCL-R3-040 | Swarm orchestration missing |
| VCL-R3-041 | ACP IDE mode missing |
| VCL-R3-042 | Local REST/WebSocket server and web UI missing |
| VCL-R3-043 | Hooks missing |
| VCL-R3-044 | Plugin system/marketplace missing |
| VCL-R3-045 | Background/callback/resumable subagent workflow incomplete |
| VCL-R3-046 | Clipboard image/video input missing |
| VCL-R3-047 | External editor workflow missing |
| VCL-R3-048 | Shell Mode lifecycle differs materially from current Kimi |
| VCL-R3-049 | Venice Plan Mode is stricter than current Kimi Bash behavior |
| VCL-R3-050 | Responses API CLI remains minimal |
| VCL-R3-051 | `venice init` does not match Kimi `/init` repository analysis |
| VCL-R3-052 | Config parse failure silently falls back to defaults |
| VCL-R3-053 | History/usage persistence lacks config's atomic/symlink hardening |
| VCL-R3-054 | CI action SHAs use deprecated embedded Node runtime |
| VCL-R3-055 | Unit tests perform live model-catalog network work |
| VCL-R3-056 | Publish workflow does not actually publish |
| VCL-R3-057 | Machine-mode updater/SIGINT behavior can contaminate structured output |

## P3

| ID | Finding |
|---|---|
| VCL-R3-058 | `.venice` scaffolding has no explicit secret/file-mode policy |
| VCL-R3-059 | Checkpoint files are non-atomic and corrupt state is silently discarded |
| VCL-R3-060 | Session import accepts arbitrary status strings via cast |
| VCL-R3-061 | MCP trust-store parse corruption silently becomes empty trust |
| VCL-R3-062 | `--plan` help says read-only although Plan artifact writes are allowed |
| VCL-R3-063 | Docs can imply project config precedence that does not exist |
| VCL-R3-064 | Static slash registry remains separate from Skill catalog |
| VCL-R3-065 | MCP pagination needs max-page/max-tool bounds |
| VCL-R3-066 | Additional-root UX often requires absolute paths |
| VCL-R3-067 | Release/version metadata should be reviewed after parity milestone |

---

# 6. Detailed Critical Findings

## VCL-R3-001 — Headless auto-validation is an untrusted repository execution path

**Severity:** P0  
**Confidence:** CONFIRMED

Noninteractive mode defaults to `auto-edit`.

`PermissionManager` includes:

```ts
if (this.mode === 'auto-edit' && toolName === 'run_validation') {
  return true;
}
```

Validation commands are inferred from repository-controlled files:

```ts
if (scripts.test)  command = `npm run test`;
if (scripts.lint)  command = `npm run lint`;
if (scripts.build) command = `npm run build`;
```

After an edit:

```ts
if (editedThisTurn && this.autoValidate) {
  await this.runValidation();
}
```

Malicious fixture:

```json
{
  "scripts": {
    "test": "node -e \"require('fs').writeFileSync('/tmp/venice-validation-pwned','1')\""
  }
}
```

Then:

```bash
venice -p "Update the README title"
```

can auto-edit the repo and automatically execute the repository's script without a human approval.

### Required architecture

Separate edit permission from executable-workspace trust.

```ts
interface WorkspaceTrust {
  root: string;
  readWrite: boolean;
  executeRepositoryCode: boolean;
}
```

`auto-edit` MUST NOT imply `executeRepositoryCode`.

Validation should return provenance:

```ts
interface ValidationCommand {
  command: string;
  sourcePath: string;
  sourceKind: 'package-script' | 'toolchain-convention';
  requiresWorkspaceExecutionTrust: boolean;
}
```

Generalize this same execution-trust primitive for:
- validation;
- project MCP;
- future hooks;
- future plugins;
- custom executable agents.

### Security regression test

Create a repo with a test script that writes outside the repo.

Run a headless edit.

Assert:
- edit can proceed according to auto-edit;
- validation is denied/prompted without execution trust;
- outside marker does not exist.

---

## VCL-R3-002 — Current live head is red

Fix the two non-hermetic/nonportable tests first.

Do not make production animation ignore CI just to satisfy the test.

Do not assume chmod `000` is an unreadable-file primitive on Windows.

After fixes:

```bash
npm ci
npm run verify
```

and all GitHub matrix jobs must be green.

---

## VCL-R3-003 — Multi-root checkpoints restore the wrong file

**Severity:** P1

Example:

```text
primary:    /work/app
additional: /work/shared
target:     /work/shared/src/a.ts
```

The tool records:

```text
relativePath = src/a.ts
```

CheckpointManager only knows:

```text
workspaceRoot = /work/app
```

Undo performs:

```ts
path.join(workspaceRoot, relativePath)
```

which restores:

```text
/work/app/src/a.ts
```

instead of:

```text
/work/shared/src/a.ts
```

### Fix

Use a root-aware file identity:

```ts
interface WorkspaceFileRef {
  rootId: string;
  relativePath: string;
}
```

CheckpointManager must receive a WorkspaceScope and revalidate the target on every undo/redo.

Test two roots that both contain `src/a.ts`.

---

## VCL-R3-004 — Changed-file tracking collapses root identity

Tool-local WorkspaceManager resolves the correct additional root but returns:

```ts
affectedFiles: [relative]
```

The parent runtime later does:

```ts
this.workspace.markChanged(file)
```

which interprets it relative to primary root.

Change metadata to structured root-aware refs and persist that structure.

---

## VCL-R3-005 — Tool schemas are advisory

**Severity:** P1

Runtime verifies only that model tool arguments are JSON.

It does not validate the parsed value against the tool's `inputSchema` before:
- dynamic risk classification;
- permission matching;
- execution.

### Fix

Compile AJV validators per tool registration.

Execution order:

```text
parse
-> schema validate
-> normalize only explicit compatibility fields
-> risk
-> permissions
-> execute
```

MCP schema compilation must disallow remote `$ref` loading and enforce schema-size limits.

---

## VCL-R3-006 — Model capability discovery fails open

Current:

```ts
mode: supportsFunctionCalling === false ? 'chat-only' : 'agent'
```

`undefined` therefore means agent.

Change to positive evidence:

```ts
mode: supportsFunctionCalling === true ? 'agent' : 'chat-only'
```

Unknown model IDs must not receive tools by default.

---

## VCL-R3-007 — `-p` is not reliably noninteractive

Current Kimi contract:

```text
kimi -p "..." -> no TUI
```

Venice's interactive calculation does not include `options.prompt`.

Fix:

```ts
const promptMode = options.prompt !== undefined;
const interactive =
  options.interactive ??
  (!promptMode && stdinTTY && stdoutTTY && outputFormat === 'text');
```

Add pseudo-TTY process test.

---

## VCL-R3-008 — `--output-format json` can enter TUI

Any machine output format must force headless behavior or be rejected outside `-p`.

If exact Kimi parity:
- only `text|stream-json`;
- output-format requires prompt.

If Venice retains final-state `json`, define it as a Venice extension but keep stdout machine-pure.

---

## VCL-R3-009 — Session import is lossy

`AgentState` contains durable fields including:

```text
modelProfile
tokenUsage
contextSummary
checkpoint indices
plan
lastValidation
```

The import normalizer rebuilds a subset and drops fields.

Create a versioned decoder/migration schema.

Round-trip invariant:

```ts
decode(encode(state)) == normalizedState
```

for all durable fields.

---

## VCL-R3-010 — `.venice/config.json` generated by init is dead

`venice init` creates project settings for approval, validation, and compaction.

Runtime config only reads `~/.venice/config.json`.

Either implement project config or remove the file from init.

Preferred precedence:

```text
CLI
> environment
> project .venice/config.json
> global ~/.venice/config.json
> defaults
```

Project config must not carry user authentication secrets.

---

## VCL-R3-011 — stream-json needs a protocol envelope

Current internal event bus is richer than JSONL output.

Define:

```ts
interface AgentProtocolEvent<T> {
  schemaVersion: 2;
  sequence: number;
  eventId: string;
  sessionId: string;
  turnId?: string;
  timestamp: string;
  type: string;
  data: T;
}
```

Include approval, validation, subagent, mode, file-change, MCP, compaction, and persistence events.

This should become the shared substrate for ACP/web.

---

## VCL-R3-012 — Runtime still does non-streaming model calls

The client exposes `stream()`, but runtime uses `complete()`.

Implement incremental:
- assistant content;
- reasoning;
- tool call IDs;
- function names;
- fragmented arguments;
- finish reason;
- usage.

Persist one canonical assistant message after the stream finishes.

---

## VCL-R3-013 — MCP tools pagination

Current MCP `tools/list` is one request.

Implement cursor loop with:
- repeated cursor detection;
- max pages;
- max tools;
- max cumulative metadata bytes.

---

## VCL-R3-014 — MCP list-changed notification ignored

Add notification handling:

```ts
client.onNotification(...)
```

On `notifications/tools/list_changed`:
- refetch all pages;
- atomically replace server namespace in registry;
- emit runtime event.

---

## VCL-R3-015 — MCP missing protocolVersion accepted

Reject initialize responses without a nonempty `protocolVersion`.

Do not silently substitute the client's preferred revision.

---

## VCL-R3-016 — MCP `isError:true` is shown as success

MCP tool logical failures may be valid JSON-RPC results.

Normalize:

```ts
if (result.isError === true) {
  return {
    ok: false,
    error: {
      code: 'MCP_TOOL_REPORTED_ERROR',
      message: extractMcpError(result),
      details: result
    }
  };
}
```

Keep structured payload available to the model.

---

## VCL-R3-017 — MCP trust needs an explicit executable-drift contract

Trust hashes only `.venice/mcp.json`.

Changing a referenced local script does not invalidate trust.

Neither does a mutable command such as:

```text
npx package@latest
```

Choose:

### Workspace execution trust
Approval means executable code in this workspace may change and remain trusted.

or:

### Exact executable provenance trust
Fingerprint executable/script/package-lock identity.

Make the prompt describe the chosen semantics accurately.

---

## VCL-R3-018 — Venice Chat current fields incomplete

Current official Chat Completions includes fields not represented in the shared request type:

```text
reasoning
max_temp
min_temp
user
store
text
include
metadata
```

Add strong types and field-level contract tests.

---

# 7. Significant P2 Findings

## VCL-R3-019 — MCP protocol revision stale

Current client only supports:

```text
2024-11-05
```

Current MCP revision is:

```text
2025-06-18
```

Upgrade only after conformance tests.

---

## VCL-R3-020 — MCP startup serial

Start multiple independent MCP servers with bounded concurrency, then register results deterministically.

---

## VCL-R3-021 — MCP metadata under-modeled

Model:
- `title`;
- `outputSchema`;
- `annotations`;
- `structuredContent`;
- `isError`.

Treat annotations as untrusted metadata.

---

## VCL-R3-022 — `parallelSafe` is unused

Runtime executes all model tool calls serially.

Parallelize only batches whose tools are explicitly `parallelSafe:true`.

Keep writes/shell/MCP/plan/session mutation ordered.

---

## VCL-R3-023 — Additional roots are not validated

Auto-validation scans only primary workspace root.

Once root-aware affected files exist, group changes by root and detect validation independently.

---

## VCL-R3-024 — Plan tracking for additional roots is ambiguous

A plan in an additional root can become:

```text
../shared/PLAN.md
```

in changed-file metadata.

Use WorkspaceFileRef.

---

## VCL-R3-025 — Existing Plan path must be revalidated

Before writing an existing plan:

```ts
workspace.assertInsideWorkspace(existing.filePath)
```

Better: persist a root-aware Plan file ref rather than raw absolute path.

---

## VCL-R3-026 — Import decoder casts complex arrays

Validate each message, todo, tool invocation, Skill summary, and subagent report.

---

## VCL-R3-027 — Model discovery uses live network in unit paths

Inject a ModelCatalog client/cache.

Unit tests must be offline and fast.

---

## VCL-R3-028 — Unknown model context assumes 128K

Use conservative unknown context or an explicit unknown state.

---

## VCL-R3-029 — Startup conflicts differ from Kimi

Current Kimi rejects:

```text
--continue + --session
--yolo + --auto
--prompt + --yolo
--prompt + --auto
--prompt + --plan
--output-format without --prompt
```

Venice only enforces part of this.

If exact parity is intended, add one conflict validator.

---

## VCL-R3-030 — `--skills-dir` semantics differ

Kimi's flag replaces default user/project Skills directories.

Venice adds directories on top.

Either match Kimi or document additive Venice semantics.

---

## VCL-R3-031 — Custom main agents missing

Implement:

```text
--agent <name>
--agent-file <path>
```

Persist selected agent with session identity.

Treat project agent definitions as high-authority prompt configuration and show trust guidance.

---

## VCL-R3-032 — Active Skills are not slash commands

Current Kimi registers active Skills in slash completion.

Venice should dynamically contribute slash definitions from SkillRegistry.

---

## VCL-R3-033 — Context undo missing

Implement `/undo [count]` for prompts/context/todos/plan-state without reverting code.

Keep it distinct from checkpoint undo.

---

## VCL-R3-034 — Reload missing

Add:
- `/reload`;
- `/reload-tui`.

Reload config without silently changing session identity.

---

## VCL-R3-035 — `/copy` missing

Use platform clipboard abstraction; no shell-string interpolation.

---

## VCL-R3-036 — Live `/add-dir` missing

Add/list/remove extra roots during a running session.

Persist them.

Do not inherit execution trust automatically if trust is root-specific.

---

## VCL-R3-037 — Background task manager missing

Kimi supports:
- background Bash;
- task IDs;
- TaskList/Output/Stop;
- Ctrl+B foreground-to-background.

Build a runtime TaskManager with process-tree cleanup and bounded output.

---

## VCL-R3-038 — `/btw` missing

Implement isolated side-channel model conversation that does not mutate main history.

---

## VCL-R3-039 — Goal mode missing

Goals need lifecycle:
- active;
- paused;
- blocked;
- complete.

Do not equate a todo list with goals.

---

## VCL-R3-040 — Swarm missing

Do not add until subagent IDs, resume/callback, parallel budgets, and cancellation are stable.

---

## VCL-R3-041 — ACP missing

Add:

```bash
venice acp
```

Requirements:
- JSON-RPC stdin/stdout;
- no banner on stdout;
- logs stderr;
- reuse AgentRuntime;
- sessions, approvals, cancellation, modes, tools.

---

## VCL-R3-042 — Local server/web missing

First secure milestone:

```bash
venice server run --foreground
venice web --no-open
```

Security:
- loopback;
- bearer auth;
- Host/Origin checks;
- no unauthenticated LAN;
- reuse event protocol.

---

## VCL-R3-043 — Hooks missing

Reuse runtime events.

Project hooks execute code, so execution trust is mandatory.

---

## VCL-R3-044 — Plugins missing

A mature plugin can package:
- Skills;
- agents;
- MCP;
- hooks;
- prompt sections;
- slash commands.

No install-time code execution.

Copy managed plugins into user-controlled storage and reject symlink escape.

---

## VCL-R3-045 — Subagent lifecycle incomplete

Add:
- stable subagent ID;
- background mode;
- callback/continue;
- cancellation;
- token/turn budget;
- safe parallel scheduling.

Keep Venice's useful review/research/test taxonomy.

---

## VCL-R3-046 — Clipboard media missing

Venice should support this especially well because image/video capabilities are first-class.

Add:
- image paste;
- video paste;
- model capability guard;
- size limits;
- file-backed attachments rather than binary session JSON.

---

## VCL-R3-047 — External editor missing

Add Ctrl-G and `/editor`.

Use argv-based process spawning.

---

## VCL-R3-048 — Shell Mode differs from Kimi

Venice's persistent Ctrl-X shell mode is a product divergence.

Current Kimi's shell mode is more command-scoped and includes backgrounding.

Either align or document the difference.

---

## VCL-R3-049 — Plan Bash behavior differs

Kimi keeps Bash under ordinary permissions in Plan mode.

Venice hides shell entirely.

This is defensibly stricter. Mark it intentional rather than calling it parity.

---

## VCL-R3-050 — Responses API surface minimal

Expand typed Responses support instead of leaving it as a small generic wrapper.

---

## VCL-R3-051 — Init semantics differ

Split:
- deterministic `config init`;
- agent-driven repository `init` that can produce AGENTS.md.

Never overwrite existing AGENTS.md without explicit approval.

---

## VCL-R3-052 — Malformed user config silently becomes defaults

Use strict runtime loading and tolerant `doctor` diagnostics.

---

## VCL-R3-053 — History/usage storage weaker than config

Create one atomic private JSON writer.

---

## VCL-R3-054 — Action runtime deprecation

Update checkout/setup-node to current immutable SHAs.

Keep SHA pinning.

---

## VCL-R3-055 — Live-network unit tests

Inject catalog responses.

Keep live API checks in integration/contract stage.

---

## VCL-R3-056 — Publish workflow does not publish

If deliberate, document it.

If not, finish npm trusted publishing/OIDC and enable the publish step.

---

## VCL-R3-057 — Machine stdout purity

Suppress updater/progress/banner output in machine protocols.

SIGINT should not write an unstructured newline to stdout.

Shutdown runtime/MCP cleanly before exit.

---

# 8. Root-Aware Workspace Redesign

Introduce:

```ts
interface WorkspaceRootRef {
  id: string;
  absolute: string;
}

interface WorkspaceFileRef {
  rootId: string;
  relativePath: string;
}
```

Never persist ambiguous strings for changed files/checkpoints.

Flow:

```text
input
-> WorkspaceScope.resolve
-> WorkspaceFileRef
-> tool result affectedFiles
-> runtime tracking
-> checkpoint
-> session
-> renderer/protocol
```

---

# 9. Session Schema Redesign

Create explicit schema/migrations.

Classify every field:
- durable;
- derived;
- ephemeral.

Round-trip test every durable field.

Do not hand-copy AgentState in import code.

---

# 10. Machine Event Protocol V2

Recommended event envelope:

```json
{
  "schemaVersion": 2,
  "sequence": 42,
  "eventId": "evt-...",
  "sessionId": "ses-...",
  "turnId": "turn-...",
  "type": "tool.completed",
  "timestamp": "...",
  "data": {}
}
```

Minimum events:

```text
session.started/resumed/completed/failed/persist_failed
user.message/queued/injected
model.started
assistant.delta/completed
approval.requested/resolved
tool.requested/started/completed
file.changed
validation.started/completed
subagent.started/completed
plan.changed
mode.changed
mcp.server_started/server_failed/tools_changed
context.compacted
```

---

# 11. Kimi Parity Matrix

Legend:

```text
✅ substantial
🟡 partial
❌ missing
◇ intentional Venice divergence
```

| Capability | Status | Notes |
|---|---:|---|
| Project agent TUI | ✅ | |
| Files/search/git | ✅ | Multi-root identity bug remains |
| Plan artifact | ✅ | |
| Plan exit approval | ✅ | |
| Bash available in Plan | ◇ | Venice stricter |
| Shell mode | 🟡 | No background task parity |
| `--continue` | ✅ | |
| `--session` | ✅ | |
| `-p` noninteractive guarantee | 🟡 | TTY bug |
| stream-json | 🟡 | Protocol incomplete |
| `--yolo` | ✅ | |
| `--auto` | ✅ | |
| `--plan` | ✅ | |
| `--skills-dir` | 🟡 | Wrong semantics |
| `--add-dir` | 🟡 | Root identity bugs |
| `--agent` | ❌ | |
| `--agent-file` | ❌ | |
| `/new` | ✅ | |
| `/clear` | ✅ | |
| `/sessions` / `/resume` | ✅ | |
| `/fork` | ✅ | |
| `/title` / `/rename` | ✅ | |
| `/compact <hint>` | ✅ | |
| `/undo` context | ❌ | |
| `/reload` | ❌ | |
| `/reload-tui` | ❌ | |
| export markdown | ✅ | |
| debug ZIP | ✅ | |
| JSON import/export | 🟡 | Import lossy |
| `/copy` | ❌ | |
| live `/add-dir` | ❌ | |
| `/tasks` | ❌ | |
| `/btw` | ❌ | |
| `/goal` | ❌ | |
| `/swarm` | ❌ | |
| Skill slash commands | ❌ | |
| fuzzy slash picker | ✅/🟡 | |
| unknown slash -> agent | ✅ | |
| @file | ✅/🟡 | Additional-root UX incomplete |
| queued/injected messages | ✅ | |
| structured AskUser | ✅ | |
| external editor | ❌ | |
| clipboard image/video | ❌ | |
| background shell | ❌ | |
| bounded subagents | ✅ | |
| background/callback subagents | ❌ | |
| custom main agents | ❌ | |
| MCP stdio | ✅/🟡 | Conformance gaps |
| MCP dynamic tools | ❌ | |
| ACP | ❌ | |
| local server | ❌ | |
| web UI | ❌ | |
| hooks | ❌ | |
| plugins | ❌ | |
| doctor | ✅/🟡 | |
| Venice media | ✅ | Venice advantage |
| E2EE/TEE | ✅ | Venice advantage |
| model traits/mappings | ✅ | Venice advantage |

---

# 12. Kimi-Compatible Startup Contract

If exact compatibility is intended:

```text
venice
venice -S [id]
venice -c
venice -m <model>
venice -p "<prompt>"
venice -p "<prompt>" --output-format stream-json
venice --yolo
venice --auto
venice --plan
venice --skills-dir <dir>
venice --agent <name>
venice --agent-file <path>
venice --add-dir <dir>
```

Conflict tests:

```text
-c + -S                 reject
--yolo + --auto         reject
-p + --yolo             reject
-p + --auto             reject
-p + --plan             reject
--output-format no -p   reject
--agent + --agent-file  reject
--agent + resume        reject
--agent-file + resume   reject
```

---

# 13. Implementation Order

## Phase 0
Restore green CI.

## Phase 1
Fix execution trust:
- VCL-R3-001
- VCL-R3-017

## Phase 2
Refactor root-aware identity:
- 003
- 004
- 023
- 024
- 025

## Phase 3
Tool boundary:
- 005
- 016
- MCP metadata

## Phase 4
Session schema:
- 009
- 026
- 060

## Phase 5
Streaming/machine runtime:
- 011
- 012
- 022
- 057

## Phase 6
Model/API:
- 006
- 018
- 027
- 028
- 050

## Phase 7
MCP conformance:
- 013
- 014
- 015
- 019
- 020
- 021
- 065

## Phase 8
Kimi interaction:
- 007
- 008
- 029-038
- parity decisions

## Phase 9
External surfaces:
- ACP
- server/web
- hooks
- plugins
- goals/swarm

---

# 14. Required Tests

Security:

```text
src/agent/validation-trust.security.test.ts
src/mcp/executable-drift.security.test.ts
src/tools/schema-validation.security.test.ts
```

Multi-root:

```text
src/agent/multi-root-checkpoints.test.ts
src/agent/multi-root-changed-files.test.ts
src/agent/multi-root-validation.test.ts
src/tools/agent-meta/plan.multi-root.test.ts
```

Session:

```text
src/agent/session-roundtrip.test.ts
```

CLI:

```text
src/commands/agent.print-mode.integration.test.ts
```

MCP:

```text
src/mcp/pagination.test.ts
src/mcp/list-changed.test.ts
src/mcp/protocol-negotiation.test.ts
src/mcp/tool-is-error.test.ts
src/mcp/tool-metadata.test.ts
```

Streaming:

```text
src/agent/runtime-streaming.test.ts
src/agent/stream-json.integration.test.ts
```

Model/API:

```text
src/agent/model-capability-fail-closed.test.ts
src/lib/chat-current-fields.test.ts
```

---

# 15. Acceptance Scenarios

Headless edit trust:

```bash
venice -p "change README title"
```

Untrusted repo:
- edit may proceed;
- repo scripts do not auto-run.

Multi-root:

```bash
venice --add-dir ../shared
```

Edit absolute shared file, undo, verify primary same-named file unchanged.

Machine:

```bash
venice -p "inspect package.json" --output-format stream-json \
  >events.jsonl 2>stderr.log
awk 'NF' events.jsonl | jq -c . >/dev/null
```

MCP:
- fixture exposes 2 pages;
- all tools appear;
- sends tools/list_changed;
- Venice refreshes;
- isError tool appears failed.

---

# 16. CI Improvements

Keep:
- OS matrix;
- Node runtime matrix;
- SHA-pinned actions.

Add:
- `test:unit` offline;
- `test:integration`;
- `test:protocol`;
- package-install smoke test;
- pseudo-TTY tests;
- session golden round-trip;
- multi-root tests.

---

# 17. Doctor Expansion

Add:
- project config application;
- workspace execution trust;
- repo validation script provenance;
- MCP executable drift warning;
- current MCP protocol support;
- additional-root checks;
- tool-capability resolution;
- publish readiness.

Remove checks for runtime flags that production does not actually consume.

---

# 18. Do-Not Rules

Do NOT:

1. auto-run repo validation in auto-edit without execution trust;
2. represent additional roots as `../...`;
3. call risk classification before schema validation;
4. accept missing MCP protocolVersion;
5. assume one tools page;
6. mark MCP isError as success;
7. drop session fields during import;
8. duplicate session schema manually;
9. let `-p` open TUI;
10. write updater/progress text into protocol stdout;
11. build ACP with another runtime;
12. expose unauthenticated web server to LAN;
13. add executable hooks/plugins before trust exists;
14. auto-trust project main-agent system prompts;
15. remove Venice-specific capabilities for cosmetic parity;
16. use chmod-based unreadability as a Windows unit-test primitive;
17. use live network in unit tests;
18. claim full Kimi parity while major surfaces remain absent.

---

# 19. Release Gate

Production-ready requires:

```text
[ ] exact-head CI green
[ ] validation execution trust fixed
[ ] multi-root checkpoint identity fixed
[ ] multi-root change identity fixed
[ ] tool schemas enforced
[ ] model capabilities fail closed
[ ] -p deterministically headless
[ ] machine output never launches TUI
[ ] session import/export lossless
[ ] project config implemented or removed
[ ] stream-json correlation stable
[ ] AgentRuntime actually streams
[ ] MCP pagination
[ ] MCP list_changed
[ ] MCP protocol strict/current
[ ] MCP isError normalized
[ ] current Venice Chat fields contract-tested
[ ] tests hermetic/cross-platform
```

“Kimi-like workflow” additionally:

```text
[ ] custom main agents
[ ] context undo
[ ] live add-dir
[ ] Skill slash commands
[ ] background tasks
[ ] ACP
```

Full current Kimi-style parity additionally:

```text
[ ] /btw
[ ] goals
[ ] swarm
[ ] server/web
[ ] hooks
[ ] plugins
[ ] clipboard media
[ ] external editor
[ ] background/callback subagents
```

---

# 20. Final Direction

The repository is materially stronger than the previous audited version. Many old P0/P1 findings are genuinely closed.

The remaining release blockers are architectural:

1. **Execution trust** — project MCP is gated, but auto-validation recreates repository-controlled execution.
2. **Root identity** — `--add-dir` means a file can no longer be an unqualified relative string.
3. **Tool boundary validation** — schemas must be enforced before risk/execution.
4. **Session schema** — imports must be lossless.
5. **Machine/runtime protocol** — real streaming and stable correlated events are needed before ACP/web.
6. **MCP conformance** — pagination, notifications, current protocol, tool error semantics.
7. **Model/API fail-closed behavior** — positive tool capability evidence and current Venice request fields.

After those, highest-value Kimi-like work:

```text
real AgentRuntime streaming
protocol-quality stream-json
--agent / --agent-file
live /add-dir
context /undo
Skill slash commands
background tasks
ACP
/btw
goals/swarm
server/web
hooks/plugins
```

Preserve Venice's differentiators:
- image/video/audio/music;
- web/search;
- E2EE;
- TEE;
- model traits/mappings;
- billing/keys/x402;
- privacy metadata.

Kimi is the workflow benchmark, not the product boundary.

---

# 21. Completion Report Template

```markdown
# Venice CLI Remediation Completion

## Baseline
- Starting commit:
- Ending commit:
- Node/npm:
- Clean working tree:

## Findings
| ID | Status | Files | Tests |
|---|---|---|---|

## Security
- Workspace execution trust:
- MCP trust:
- Tool schema validation:

## Multi-root
- File identity:
- Checkpoints:
- Validation:

## Sessions
- Import/export:
- Schema migration:

## MCP
- Protocol:
- Pagination:
- Notifications:
- Tool errors:

## Kimi parity
- Added:
- Intentional divergences:
- Deferred:

## Validation
- npm run lint
- npm run build
- npm run test:compiled
- npm run test:security
- npm run completions:check
- npm run api:contract
- npm audit --omit=dev
- npm run pack:check

## Remaining risks
- ...
```
