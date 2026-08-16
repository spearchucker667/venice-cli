# Venice CLI — Exhaustive Bug, Security, Missing-Feature & Release Audit
## Agent Handoff — 2026-08-16

**Repository:** `https://github.com/spearchucker667/venice-cli`  
**Audited branch:** `main`  
**Audited commit:** `6e2ba3653dd46241812fbd9ee91f6399993d73b4`  
**Commit message:** `fix: support atomic session sync on Windows`  
**Package version at audited commit:** `2.1.0`  
**Primary upstream:** `https://github.com/veniceai/venice-cli`  
**Official API source of truth:** `https://github.com/veniceai/api-docs` and `https://docs.venice.ai/swagger.yaml`

---

# 0. Mission

Take the findings in this handoff and bring `spearchucker667/venice-cli` to a production-grade agent CLI with:

1. enforceable security boundaries rather than advisory boundaries;
2. correct, least-privilege approval semantics;
3. safe MCP and shell execution;
4. complete Venice API capability discovery and current API parity;
5. reliable cancellation, streaming, persistence, and recovery;
6. shell completions that reflect the actual CLI dynamically;
7. CI gates that cover all shipped TypeScript/TSX and API-contract drift;
8. release metadata and provenance that match the repository actually being shipped.

Do **not** blindly implement snippets below. Inspect the current code at the pinned commit first, write regression tests that fail for each confirmed defect, then implement the smallest architecture-level fix that closes the class of bug.

---

# 1. Evidence Standard

Finding labels:

- **CONFIRMED** — directly demonstrated by code at the audited commit.
- **CONFIRMED GAP** — an official Venice API surface exists and repo search/current implementation does not expose it.
- **INFERRED** — strongly implied by code but should be reproduced locally before changing behavior.
- **HARDENING** — not necessarily a functional bug today, but a production/security gap.

Severity:

- **P0** — security boundary failure or dangerous automatic behavior.
- **P1** — material correctness/security/reliability defect.
- **P2** — important feature parity, UX, testing, release, or maintainability gap.
- **P3** — polish/hardening.

---

# 2. Source-of-Truth Hierarchy

When implementation behavior conflicts with documentation, use this order:

1. Current Venice OpenAPI:
   - `https://docs.venice.ai/swagger.yaml`
   - `https://github.com/veniceai/api-docs/blob/main/swagger.yaml`
2. Current official Venice API docs:
   - `https://docs.venice.ai/api-reference/api-spec`
   - `https://docs.venice.ai/llms.txt`
   - `https://docs.venice.ai/llms-full.txt`
3. Current model metadata from:
   - `GET /api/v1/models`
   - `GET /api/v1/models/traits`
   - `GET /api/v1/models/compatibility_mapping`
4. Existing passing repo tests.
5. Existing docs/comments only after verification against sources 1–4.

Never hard-code a Venice model capability where the API already exposes it.

---

# 3. Executive Finding Summary

## P0 — fix before considering agent auto modes safe

1. **Shell “workspace-only” boundary is not enforced.**
2. **MCP tools can be auto-approved as generic `execute` operations despite arbitrary external side effects.**

## P1 — fix immediately after P0

3. Runtime ignores each tool’s declared `risk`.
4. Pattern approval scope is broken and becomes effectively tool-wide.
5. Shell inherits the entire parent environment, exposing credentials to agent commands.
6. Tool inputs/results/events can persist secrets to disk without redaction.
7. Shell timeout does not reliably terminate descendant processes.
8. Streaming requests lose the request timeout after headers and can hang indefinitely.
9. Non-stream chat silently drops `additionalHeaders`.
10. SSE parsing silently discards malformed chunks.
11. Model capability discovery fails open into agent/tool mode.
12. Project-instruction load failures are silently ignored.
13. Rate-limit retry sleeps even when no retry remains and ignores `Retry-After`.
14. Checkpoint operations are misclassified by the central permission classifier.

## P2 — API parity / quality / UX

15. Current Venice Responses API surface is absent.
16. `/models/traits` is absent.
17. `/models/compatibility_mapping` is absent.
18. Agent model profiles omit material current capability fields.
19. Chat request abstraction exposes only a subset of current Chat Completions controls.
20. `parallel_tool_calls` is not surfaced.
21. `max_completion_tokens` and multiple current sampling controls are not surfaced.
22. x402 wallet authentication is not surfaced by the API client.
23. Embeddings CLI defaults to a stale/unsupported-looking model ID.
24. Embeddings CLI omits `dimensions` and `encoding_format`.
25. Shell completions omit newer top-level commands.
26. Shell completions hard-code a tiny, quickly stale model list.
27. `models` output hides capability/context/pricing/trait/deprecation data useful to agents.
28. CI lint excludes `.tsx`.
29. No OpenAPI drift/contract gate exists.
30. Several large shipped command modules have no direct command-level test file.
31. GitHub Actions use mutable action tags rather than immutable SHAs.
32. Package repository/bugs metadata points to upstream instead of the audited fork.
33. No automated generated-completion parity test exists.
34. No explicit secret-redaction regression suite exists.

## P3 / hardening

35. Session atomic rename is not directory-fsynced on POSIX.
36. Existing session directory/file permissions are not repaired/verified.
37. API JSON/error response reads are not consistently size-bounded.
38. Network retry backoff lacks jitter.
39. `models --type` accepts invalid values and silently returns no matches.
40. Security semantics are duplicated across tool declarations and a central name list.

---

# 4. Detailed Findings

---

## VC-AUD-001 — P0 — Shell workspace sandbox is not a sandbox
**Status:** CONFIRMED  
**Area:** `src/tools/shell/execute.ts`, `src/agent/workspace.ts`, `src/agent/permissions.ts`

### Evidence

`src/tools/shell/execute.ts` validates only the starting working directory:

```ts
const workspace = new WorkspaceManager(context.workspaceRoot);
const cwd = input.cwd
  ? workspace.resolve(input.cwd).absolute
  : workspace.workspaceRoot;

const shell = process.platform === 'win32' ? 'cmd.exe' : 'bash';
const args = process.platform === 'win32'
  ? ['/c', input.command]
  : ['-c', input.command];

const child = spawn(shell, args, {
  cwd,
  env: { ...process.env, PWD: cwd },
});
```

That does **not** confine filesystem accesses performed by `input.command`.

The tool description says:

```ts
description: 'Execute a shell command inside the workspace.'
```

`PermissionManager` auto-approves ordinary `execute` risk in `auto` mode.

### Reproduction examples

On macOS/Linux, with a workspace at `/tmp/project`:

```text
shell({"command":"cat ~/.ssh/id_ed25519"})
shell({"command":"cat /etc/passwd"})
shell({"command":"printf owned > ../outside-workspace.txt"})
shell({"command":"cd ~ && pwd && find . -maxdepth 2 -type f | head"})
```

On Windows:

```text
shell({"command":"type %USERPROFILE%\\.ssh\\id_ed25519"})
shell({"command":"echo owned>..\\outside-workspace.txt"})
shell({"command":"powershell -NoProfile -Command \"Get-ChildItem $HOME\""})
```

The initial `cwd` is inside the workspace, but the command is free to escape it.

### Required fix

Do **not** attempt to solve this with regex path inspection. Shell syntax, subshells, aliases, symlinks, interpreters, environment expansion, scripting languages, redirections, and child processes make string filtering non-enforceable.

Choose one explicit contract:

**Preferred safe contract:**
- rename/describe shell as an unsandboxed OS execution tool;
- never auto-approve it in `auto`;
- require explicit approval for every shell call unless the user opted into an explicitly unsafe mode;
- show command, cwd, and risk in approval UI;
- document that shell has the privileges of the current user.

**If true confinement is required:**
- run inside a real sandbox/container boundary;
- Linux: consider bubblewrap/nsjail/container isolation;
- macOS: use a supported sandbox/container strategy rather than claiming cwd confinement;
- Windows: use an enforceable restricted environment/container or do not claim filesystem sandboxing.

### Regression test

```ts
it('does not auto-approve shell in auto mode', async () => {
  const permissions = new PermissionManager('auto');
  assert.equal(
    await permissions.isApproved('shell', { command: 'cat ~/.ssh/id_ed25519' }, 'execute'),
    false
  );
});
```

Add an end-to-end test proving a claimed workspace sandbox cannot create/read outside the workspace. If no real sandbox is implemented, the test should instead assert that approval is mandatory.

### Sources

- Repo: `https://github.com/spearchucker667/venice-cli/blob/6e2ba3653dd46241812fbd9ee91f6399993d73b4/src/tools/shell/execute.ts`
- Repo: `https://github.com/spearchucker667/venice-cli/blob/6e2ba3653dd46241812fbd9ee91f6399993d73b4/src/agent/workspace.ts`
- Repo: `https://github.com/spearchucker667/venice-cli/blob/6e2ba3653dd46241812fbd9ee91f6399993d73b4/src/agent/permissions.ts`

---

## VC-AUD-002 — P0 — Arbitrary MCP tools are auto-approved in `auto`
**Status:** CONFIRMED  
**Area:** MCP adapter + permission classification

### Evidence

Every MCP tool is adapted with:

```ts
risk: 'execute'
```

and a name:

```ts
const namespacedName = `mcp:${serverName}:${tool.name}`;
```

The central `classifyRisk()` does not understand these names and falls through to:

```ts
return 'execute';
```

`auto` mode approves `execute`.

An MCP tool may send email, modify GitHub, delete a cloud resource, post messages, modify databases, perform network calls, or write outside the workspace. The runtime has no generic way to infer those side effects from an arbitrary MCP tool name/schema.

### Required fix

Treat unclassified MCP tools as **approval-required** by default.

Recommended model:

```ts
export type RiskLevel =
  | 'read'
  | 'write'
  | 'execute'
  | 'network'
  | 'outside_workspace'
  | 'destructive'
  | 'external_side_effect';

export interface AgentTool {
  // ...
  risk: RiskLevel | ((input: unknown) => RiskLevel);
}
```

For MCP:

```ts
risk: 'external_side_effect'
```

Then allow users to explicitly configure trusted tool policies:

```json
{
  "mcp": {
    "servers": {
      "github": {
        "toolPolicies": {
          "get_*": "read",
          "search_*": "read",
          "create_*": "external_side_effect",
          "delete_*": "destructive"
        }
      }
    }
  }
}
```

Do not infer safety merely from prefixes without user-controlled policy.

### Sources

- Repo: `src/mcp/adapter.ts`
- Repo: `src/agent/permissions.ts`
- MCP architecture docs: `docs/architecture/adr/ADR-005-mcp-transport-architecture.md`

---

## VC-AUD-003 — P1 — Runtime ignores declared tool risk
**Status:** CONFIRMED

### Evidence

`AgentTool` requires:

```ts
risk: 'read' | 'write' | 'execute' | 'network' | 'destructive';
```

But runtime authorization does:

```ts
const risk = classifyRisk(toolName, input);
approved = await this.permissions.isApproved(toolName, input, risk);
```

It does not use `tool.risk`.

This creates two independent sources of truth.

### Concrete failure

`checkpoint_undo` declares:

```ts
risk: 'write'
```

but `classifyRisk()` does not list it, so it becomes `execute`.

### Required fix

Replace duplicated name classification with tool-owned risk:

```ts
const risk =
  typeof tool.risk === 'function'
    ? tool.risk(input)
    : tool.risk;
```

If dynamic risk is needed, make it explicit on the tool.

Add a registry test that every registered tool has an intentional risk.

### Sources

- Repo: `src/tools/types.ts`
- Repo: `src/agent/runtime.ts`
- Repo: `src/tools/agent-meta/checkpoint-undo.ts`
- Repo: `src/agent/permissions.ts`

---

## VC-AUD-004 — P1 — `pattern` approval is functionally broken
**Status:** CONFIRMED

### Evidence

Approval callback returns only:

```ts
Promise<{
  approved: boolean;
  scope?: 'once' | 'session' | 'pattern';
}>
```

No pattern value is returned.

Runtime then calls:

```ts
this.permissions.grant(decision.scope, toolName);
```

For a `pattern` grant this stores no matcher.

Later:

```ts
if (grant.pattern && !this.matchesPattern(grant.pattern, input)) continue;
if (grant.scope === 'pattern') return true;
```

Therefore a “pattern” grant with no pattern matches **all future calls for that tool**.

### Required fix

Do not represent user policy as a naked `RegExp`.

Use a serializable structured policy:

```ts
type ApprovalDecision =
  | { approved: false }
  | { approved: true; scope: 'once' }
  | { approved: true; scope: 'session' }
  | {
      approved: true;
      scope: 'pattern';
      matcher: {
        kind: 'path-glob' | 'command-prefix' | 'field-equals';
        field?: string;
        value: string;
      };
    };
```

Reject `scope:'pattern'` if matcher is absent.

### Tests

- matching path is approved;
- nonmatching path is denied;
- no matcher cannot create a pattern grant;
- repeated matching is deterministic.

### Sources

- Repo: `src/agent/permissions.ts`
- Repo: `src/agent/runtime.ts`

---

## VC-AUD-005 — P1 — Shell inherits all secrets from `process.env`
**Status:** CONFIRMED

### Evidence

```ts
env: { ...process.env, PWD: cwd }
```

A model-invoked command can run `env`, `printenv`, `set`, or access specific variables.

Potentially exposed values include:
- `VENICE_API_KEY`;
- `GITHUB_TOKEN`;
- cloud credentials;
- CI secrets exposed to the process;
- third-party API keys;
- proxy credentials.

### Required fix

Build a minimal environment allowlist.

Example:

```ts
function buildShellEnv(cwd: string): NodeJS.ProcessEnv {
  const keep = [
    'PATH',
    'LANG',
    'LC_ALL',
    'TERM',
    'TMPDIR',
    'TEMP',
    'TMP',
    'SystemRoot',
    'ComSpec',
    'PATHEXT',
  ];

  const env: NodeJS.ProcessEnv = { PWD: cwd };
  for (const key of keep) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}
```

If a task needs a credential, expose it through an explicit scoped mechanism, never through blanket inheritance.

### Sources

- Repo: `src/tools/shell/execute.ts`
- Venice API guidance that API keys are secrets: `https://docs.venice.ai/api-reference/api-spec`

---

## VC-AUD-006 — P1 — Raw tool secrets can be persisted into sessions
**Status:** CONFIRMED

### Evidence

Runtime records tool inputs/results into state/events. Session persistence writes:
- full `session.json`;
- `messages.jsonl`;
- `events.jsonl`.

A shell command such as:

```bash
printenv
```

can therefore move credentials from environment → stdout → tool result → model context/session history → disk.

### Required fix

Implement a centralized redaction boundary **before**:
- event emission;
- tool-history persistence;
- debug logs;
- transcript rendering.

Example redaction targets:

```ts
const SECRET_KEY_RE =
  /(api[_-]?key|authorization|bearer|token|secret|password|private[_-]?key|cookie)/i;
```

Do not rely only on key names. Also mask known token prefixes and exact configured secret values.

Recommended design:

```ts
const redactor = new SecretRedactor({
  knownSecrets: collectKnownSecrets(),
});

const safeInput = redactor.redact(input);
const safeResult = redactor.redact(result);
```

Provide `--no-session` / ephemeral-session support for high-sensitivity workflows.

### Sources

- Repo: `src/agent/runtime.ts`
- Repo: `src/agent/sessions.ts`

---

## VC-AUD-007 — P1 — Shell timeout can leave descendants running
**Status:** CONFIRMED DESIGN DEFECT / reproduce locally

### Evidence

Timeout logic kills only the spawned shell:

```ts
child.kill('SIGTERM');
setTimeout(() => child.kill('SIGKILL'), 5000);
```

A shell can launch descendants/background processes.

### Reproduction

```bash
bash -c 'sleep 9999 & echo $!'
```

or agent shell input:

```text
{"command":"node -e \"require('child_process').spawn('sleep',['9999'],{detached:true})\""}
```

### Required fix

Use process-tree termination.

POSIX strategy:
- spawn a new process group where appropriate;
- terminate the entire group;
- handle ESRCH safely.

Windows:
- use a Job Object or `taskkill /PID <pid> /T /F` fallback.

Test that no child remains after timeout.

### Source

- Repo: `src/tools/shell/execute.ts`

---

## VC-AUD-008 — P1 — Streaming request has no body idle timeout
**Status:** CONFIRMED

### Evidence

`apiRequest()` creates a timeout, but on a successful stream response:

```ts
if (stream) {
  clearTimeout(timeoutId);
  return response as unknown as T;
}
```

After headers arrive, the body can stall forever.

### Required fix

Support:
- caller `AbortSignal`;
- total timeout;
- idle timeout reset on every chunk;
- clean reader cancellation.

Example API:

```ts
type StreamControls = {
  signal?: AbortSignal;
  idleTimeoutMs?: number;
  totalTimeoutMs?: number;
};
```

Use `AbortSignal.any()` where runtime support allows, or manually fan in abort controllers.

### Sources

- Repo: `src/lib/api.ts`
- Official docs recommend streaming for long-running chat requests:
  `https://docs.venice.ai/api-reference/endpoint/chat/completions`

---

## VC-AUD-009 — P1 — Non-stream chat drops `additionalHeaders`
**Status:** CONFIRMED

### Evidence

`ChatCompletionRequestOptions` contains:

```ts
additionalHeaders?: Record<string, string>;
```

Streaming forwards it:

```ts
additionalHeaders: options.additionalHeaders,
```

Non-stream `chatCompletion()` does not pass it into `apiRequest()`.

### Required fix

```ts
const response = await apiRequest(..., {
  method: 'POST',
  body,
  spinnerText: 'Thinking...',
  showSpinner: options.showSpinner,
  additionalHeaders: options.additionalHeaders,
});
```

### Regression test

Mock `fetch`, invoke non-stream chat with a sentinel header, and assert the header arrives.

### Source

- Repo: `src/lib/api.ts`

---

## VC-AUD-010 — P1 — SSE JSON errors are silently swallowed
**Status:** CONFIRMED

### Evidence

Streaming parser:

```ts
try {
  const json = JSON.parse(data);
  // ...
} catch {
  // Skip malformed JSON
}
```

This can silently drop output, usage, finish state, or tool-call fragments.

### Required fix

Distinguish:
- ignorable SSE heartbeat/comment;
- valid `[DONE]`;
- malformed JSON data.

Malformed JSON should produce a typed protocol error with a bounded/redacted preview.

Also flush the `TextDecoder` at stream completion.

### Source

- Repo: `src/lib/api.ts`

---

## VC-AUD-011 — P1 — Model capability discovery fails open into agent mode
**Status:** CONFIRMED

### Evidence

Initial runtime state is:

```ts
agentMode: 'agent'
```

`start()` tries model profile discovery, but failures fall back to context-limit heuristics. If profile discovery fails, tool capability remains unknown while the runtime retains agent mode.

`profileModel()` itself only switches to chat-only when:

```ts
supportsFunctionCalling === false
```

Unknown/undefined effectively behaves as tool-capable.

### Risk

A temporary `/models` failure can cause tools to be sent to a model that does not support function calling.

### Required fix

Fail closed:

```ts
mode:
  supportsFunctionCalling === true
    ? 'agent'
    : 'chat-only'
```

If explicit user override is desired, make it visible:

```bash
venice agent --force-tools
```

### Sources

- Repo: `src/agent/runtime.ts`
- Repo: `src/agent/model-profile.ts`
- Current model capability contract:
  `https://docs.venice.ai/api-reference/endpoint/models/list`

---

## VC-AUD-012 — P1 — Project instructions can fail silently
**Status:** CONFIRMED

### Evidence

Runtime:

```ts
try {
  const instructions = await loadInstructions(this.state.workspaceRoot);
  this.context.setProjectInstructions(instructions.text);
} catch {
  // Instructions are best-effort in Phase 2.
}
```

If project instructions are part of expected agent behavior, silently dropping them is dangerous and makes runs nondeterministic.

### Required fix

At minimum:
- emit `instructions_failed`;
- render a warning in TUI;
- persist the warning;
- optionally refuse write-capable mode until user acknowledges.

Do not continue invisibly.

### Sources

- Repo: `src/agent/runtime.ts`
- Repo: `src/agent/instructions.ts`

---

## VC-AUD-013 — P1 — Rate-limit retry semantics are incomplete
**Status:** CONFIRMED

### Evidence

429 handling sleeps and `continue`s without first checking whether another attempt remains.

It also does not honor `Retry-After`.

### Required fix

```ts
if (error.isRateLimited()) {
  if (attempt >= retries) throw error;
  const delay = parseRetryAfter(error.headers) ?? backoffWithJitter(attempt);
  await sleep(delay);
  continue;
}
```

Carry relevant response headers into `VeniceApiError`.

### Source

- Repo: `src/lib/api.ts`

---

## VC-AUD-014 — P1 — Checkpoint risk is misclassified
**Status:** CONFIRMED

### Evidence

`checkpoint_undo` declares `risk:'write'`, but the name is absent from central `classifyRisk()`, so it falls through to `execute`.

Same architecture affects other future tools unless every new tool is manually added twice.

### Required fix

Covered by VC-AUD-003: remove duplicate central name mapping.

### Sources

- Repo: `src/tools/agent-meta/checkpoint-undo.ts`
- Repo: `src/agent/permissions.ts`

---

# 5. Venice API Parity Gaps

## VC-AUD-015 — P2 — Responses API is absent
**Status:** CONFIRMED GAP

Current official Venice docs advertise an OpenAI-compatible **Responses API (Alpha)** at `POST /responses`.

Repo search at the audited commit found no implementation surface for `responses`.

### Required work

Add a deliberately alpha-labeled command/client surface, e.g.:

```bash
venice responses create ...
```

Do not force it through Chat Completions types; model typed output blocks separately.

### Source

- Official docs index: `https://docs.venice.ai/llms.txt`

---

## VC-AUD-016 — P2 — Model Traits endpoint is absent
**Status:** CONFIRMED GAP

Official endpoint:

```http
GET /api/v1/models/traits
```

Example traits include `default` and `fastest`.

### Why it matters

The CLI currently hard-codes default/fallback assumptions and shell completion model IDs. Traits let Venice control defaults dynamically.

### Required work

API:

```ts
export async function listModelTraits(type = 'text') {
  return apiRequest('/models/traits?...');
}
```

CLI:

```bash
venice models traits
venice models traits --type text --format json
```

### Source

- `https://docs.venice.ai/api-reference/endpoint/models/traits`

---

## VC-AUD-017 — P2 — Compatibility Mapping endpoint is absent
**Status:** CONFIRMED GAP

Official endpoint:

```http
GET /api/v1/models/compatibility_mapping
```

### Required work

Expose API + CLI:

```bash
venice models mappings
venice models mappings --type text
```

Use mappings in UX to explain an OpenAI-compatible name without silently pretending it is a native Venice model ID.

### Source

- `https://docs.venice.ai/api-reference/endpoint/models/compatibility_mapping`

---

## VC-AUD-018 — P2 — Agent model profile omits current capability fields
**Status:** CONFIRMED GAP

Current profile includes:
- function calling;
- reasoning;
- vision;
- E2EE;
- TEE.

Current `/models` docs also expose material fields such as:
- `optimizedForCode`;
- `supportsLogProbs`;
- `supportsMultipleImages`;
- `supportsResponseSchema`;
- `supportsVideoInput`;
- `supportsWebSearch`;
- `supportsXSearch`;
- constraints;
- traits;
- pricing;
- offline/deprecation-related metadata where present.

### Required fix

Extend the profile and use it for:
- tool availability;
- attachment validation;
- structured-output UI;
- reasoning controls;
- model picker labels;
- cost/context display;
- code-agent model ranking.

### Source

- `https://docs.venice.ai/api-reference/endpoint/models/list`

---

## VC-AUD-019 — P2 — Chat request wrapper exposes only a subset of current API controls
**Status:** CONFIRMED GAP

Current `ChatCompletionRequestOptions` exposes a narrow set:
- model;
- tools/tool choice;
- `venice_parameters`;
- extra headers;
- response format;
- reasoning effort;
- prompt cache;
- spinner.

Current official Chat Completions docs expose additional controls including:
- `frequency_penalty`;
- `logprobs`;
- `top_logprobs`;
- `max_completion_tokens`;
- `max_temp`;
- deprecated `max_tokens`;
- `min_p`;
- `min_temp`;
- `n`;
- `presence_penalty`;
- `repetition_penalty`;
- structured `reasoning`;
- `seed`;
- `stop`;
- `stop_token_ids`;
- `temperature`;
- `top_k`;
- `top_p`;
- `user`;
- `store`;
- `text`;
- `include`;
- `metadata`;
- `parallel_tool_calls`.

### Required work

Create a strongly typed request surface generated or validated from the OpenAPI spec.

Do not add dozens of unvalidated `Record<string, unknown>` fields manually without contract tests.

### Source

- `https://docs.venice.ai/api-reference/endpoint/chat/completions`

---

## VC-AUD-020 — P2 — `parallel_tool_calls` not exposed
**Status:** CONFIRMED GAP

This matters directly to an agent CLI because parallel tool execution changes ordering, safety prompts, checkpointing, and mutation conflicts.

### Required design

Before enabling it:
- allow parallelism only for tools explicitly marked concurrency-safe;
- serialize write/destructive tools by default;
- preserve deterministic tool-call/result association;
- define cancellation behavior.

Suggested metadata:

```ts
interface AgentTool {
  // ...
  concurrency: 'safe-read' | 'serialized';
}
```

### Source

- `https://docs.venice.ai/api-reference/endpoint/chat/completions`

---

## VC-AUD-021 — P2 — Modern token/sampling controls are missing from the abstraction
**Status:** CONFIRMED GAP

At minimum support:
- `max_completion_tokens`;
- `temperature`;
- `top_p`;
- `top_k`;
- `min_p`;
- `seed`;
- penalties;
- logprobs;
- reasoning object.

Validate controls against model constraints/capabilities returned by `/models` rather than accepting invalid combinations.

### Sources

- `https://docs.venice.ai/api-reference/endpoint/chat/completions`
- `https://docs.venice.ai/api-reference/endpoint/models/list`

---

## VC-AUD-022 — P2 — x402 wallet authentication is not a first-class client mode
**Status:** CONFIRMED GAP

Current `getHeaders()` builds Bearer auth from `requireApiKey()`.

Current official Chat and Embeddings docs state that these endpoints can also accept `X-Sign-In-With-X` for x402 wallet authentication.

### Required work

Do not overload the API-key field. Model auth as a union:

```ts
type VeniceAuth =
  | { kind: 'api-key'; apiKey: string }
  | { kind: 'x402'; signInWithX: string };
```

Keep secrets out of config dumps/session logs.

### Sources

- `https://docs.venice.ai/api-reference/endpoint/chat/completions`
- `https://docs.venice.ai/api-reference/endpoint/embeddings/generate`

---

## VC-AUD-023 — P2 — Embeddings CLI default model is stale
**Status:** CONFIRMED CODE / API mismatch; verify live before final choice

Current command default:

```ts
.option('-m, --model <model>', 'Model to use', 'text-embedding-ada-002')
```

Current Venice docs use and list native embedding models such as:

```text
text-embedding-bge-m3
text-embedding-bge-en-icl
text-embedding-multilingual-e5-large-instruct
text-embedding-qwen3-0-6b
text-embedding-qwen3-8b
text-embedding-3-small
text-embedding-3-large
...
```

The current docs/search did not establish `text-embedding-ada-002` as a current native model.

### Required fix

Best solution: use a model trait/default returned by the API.

Fallback:

```ts
const model = options.model ?? await resolveDefaultEmbeddingModel();
```

Do not replace one hard-coded model with another unless the API lacks a trait.

### Sources

- Repo: `src/commands/embeddings.ts`
- `https://docs.venice.ai/api-reference/endpoint/embeddings/generate`
- `https://docs.venice.ai/overview/pricing`

---

## VC-AUD-024 — P2 — Embeddings CLI omits current request controls
**Status:** CONFIRMED GAP

Official embeddings endpoint supports:
- `dimensions`;
- `encoding_format: "float" | "base64"`;
- multiple inputs.

Current CLI exposes only model/output/format/file.

### Required CLI

```bash
venice embeddings \
  --model text-embedding-bge-m3 \
  --dimensions 1024 \
  --encoding-format float \
  "one" "two"
```

Be careful: current positional arguments are joined into one input string. Introduce explicit `--input` repeatability if preserving backward compatibility.

### Source

- `https://docs.venice.ai/api-reference/endpoint/embeddings/generate`

---

# 6. Shell Completion Defects

## VC-AUD-025 — P2 — Generated completions omit newer top-level commands
**Status:** CONFIRMED

The completion generator hard-codes:

```text
chat search scrape parse image ... rpc completions
```

while the source tree contains newer command modules such as:
- `agent`;
- `mcp`;
- `skills`;
- `init`.

That makes tab completion disagree with the actual CLI.

### Required fix

Generate completions from Commander’s registered command tree rather than maintaining a parallel list.

If Commander introspection is insufficient, maintain one declarative command schema that drives:
- command registration;
- help;
- completions;
- docs tests.

### Source

- Repo: `src/commands/completions.ts`
- Repo tree at audited commit.

---

## VC-AUD-026 — P2 — Shell completions hard-code stale model IDs
**Status:** CONFIRMED

The completion file embeds a small static model list, while Venice currently advertises hundreds of models and model traits.

### Required fix

Implement dynamic cached completion:

```bash
venice __complete models --type text
```

Behavior:
1. use a short-lived cache under `~/.cache/venice` or platform equivalent;
2. query `/models` asynchronously/out of band where shell supports;
3. fail fast to cached values;
4. include model traits and compatibility mappings;
5. never block tab completion for seconds.

### Sources

- Repo: `src/commands/completions.ts`
- Current model catalog: `https://docs.venice.ai/models/overview`
- Traits: `https://docs.venice.ai/api-reference/endpoint/models/traits`

---

## VC-AUD-027 — P2 — `models` command hides agent-critical metadata
**Status:** CONFIRMED GAP

Pretty output shows model ID and description but not:
- context limit;
- tool/function-call capability;
- reasoning;
- vision/video;
- structured output;
- web/X search;
- E2EE/TEE;
- pricing;
- traits;
- offline/deprecation signal.

### Required UX

Add compact and detailed modes:

```bash
venice models
venice models --details
venice models --capability function-calling
venice models --capability code
venice models --capability e2ee
venice models --sort context
venice models --sort price
```

Agent model picker should consume the same normalized metadata.

### Sources

- Repo: `src/commands/models.ts`
- `https://docs.venice.ai/api-reference/endpoint/models/list`

---

# 7. CI / Test / Release Findings

## VC-AUD-028 — P2 — ESLint excludes every `.tsx` file
**Status:** CONFIRMED

Package script:

```json
"lint": "eslint \"src/**/*.ts\""
```

The repo ships a substantial Ink UI under `src/ui/*.tsx`.

### Required fix

```json
"lint": "eslint \"src/**/*.{ts,tsx}\""
```

Add a CI assertion or eslint flat-config target so future extensions cannot silently fall out of lint coverage.

### Source

- Repo: `package.json`
- Repo: `src/ui/`

---

## VC-AUD-029 — P2 — No automated OpenAPI drift gate
**Status:** CONFIRMED GAP

The CLI is broad and the Venice API changes frequently. The repo currently implements API types/endpoints by hand.

### Required work

Add:

```text
docs/reference/venice-api/
```

as a local ignored source-of-truth cache, or fetch into CI.

Suggested scripts:

```json
{
  "scripts": {
    "api:fetch": "node scripts/fetch-venice-api-docs.mjs",
    "api:contract": "node scripts/check-openapi-contract.mjs",
    "api:drift": "node scripts/check-api-drift.mjs"
  }
}
```

CI should fail when:
- a documented enum differs;
- a supported endpoint disappears;
- request fields are stale;
- model capability type definitions drift.

Pin the documentation commit used by a release so results are reproducible.

### Source

- Official docs repo: `https://github.com/veniceai/api-docs`
- OpenAPI: `https://docs.venice.ai/swagger.yaml`

---

## VC-AUD-030 — P2 — Direct test coverage is uneven across large command modules
**Status:** CONFIRMED STRUCTURAL GAP

At the audited tree, several shipped command files do not have a same-module direct command test, including large/high-value surfaces such as:
- `completions.ts`;
- `models.ts`;
- `keys.ts`;
- `billing.ts`;
- `search.ts`;
- `usage.ts`;
- `tee.ts`;
- `augment.ts`.

Some behavior may be covered indirectly. Do not assume “no same-name test” means “zero coverage”; measure before adding duplicates.

### Required work

Generate coverage:

```bash
node --test --experimental-test-coverage ...
```

or use a supported coverage runner.

Set meaningful per-area thresholds, especially:
- permission transitions;
- destructive/external tools;
- auth/header construction;
- streaming protocol parsing;
- session recovery;
- Windows/macOS/Linux path handling.

---

## VC-AUD-031 — P2 — GitHub Actions are tag-pinned, not SHA-pinned
**Status:** HARDENING

Current workflows use:

```yaml
uses: actions/checkout@v6
uses: actions/setup-node@v6
```

For stronger software-supply-chain integrity, pin third-party/actions to immutable commit SHAs and allow Dependabot/Renovate to update them.

### Required work

Example form:

```yaml
uses: actions/checkout@<full-commit-sha> # v6.x.x
```

Do not paste an arbitrary SHA from this handoff; resolve the current official SHA during implementation.

### Sources

- Repo: `.github/workflows/ci.yml`
- Repo: `.github/workflows/publish.yml`

---

## VC-AUD-032 — P2 — Package provenance metadata points away from this fork
**Status:** CONFIRMED

`package.json` at the audited fork says:

```json
"repository": {
  "type": "git",
  "url": "https://github.com/veniceai/venice-cli"
},
"bugs": {
  "url": "https://github.com/veniceai/venice-cli/issues"
}
```

If `spearchucker667/venice-cli` is intended to publish/maintain its own release line, npm users are directed to the wrong repository/issues.

### Required decision

If this fork will **not** publish npm packages, leave upstream metadata and disable fork publishing.

If this fork **will** publish:
- determine package-name ownership intentionally;
- update repository/bugs/homepage metadata;
- do not accidentally overwrite the official package;
- use a fork-specific npm package name if appropriate.

### Source

- Repo: `package.json`

---

## VC-AUD-033 — P2 — No completion parity test
**Status:** CONFIRMED GAP

The omission of new top-level commands demonstrates why generated completion output needs a contract test.

### Required test

Register all commands, extract names, and assert each supported shell generator contains or dynamically resolves every command.

Better: remove duplicated lists entirely.

---

## VC-AUD-034 — P2 — No explicit secret-redaction test suite
**Status:** CONFIRMED GAP

Given tool history, event logging, sessions, shell, MCP, and API credentials, secret redaction must have dedicated regression tests.

### Required cases

Verify that these never appear in persisted session JSON/event output:
- `VENICE_API_KEY`;
- `Authorization: Bearer ...`;
- `NPM_TOKEN`;
- GitHub tokens;
- private-key PEM blocks;
- cookies;
- configured MCP environment secrets.

---

# 8. Lower-Severity Reliability / Hardening

## VC-AUD-035 — P3 — Atomic session rename is not directory-fsynced on POSIX
**Status:** HARDENING

Current save path:
1. write temp;
2. fsync temp;
3. rename temp → canonical.

For maximum crash/power-loss durability on POSIX, fsync the parent directory after rename.

Implement platform-aware behavior; do not break Windows while fixing POSIX.

### Source

- Repo: `src/agent/sessions.ts`

---

## VC-AUD-036 — P3 — Existing session permissions are not repaired
**Status:** CONFIRMED

Directories are created with `0700` and files with `0600`, which is good.

But existing paths are only checked for existence; modes/ownership are not repaired or warned on.

### Required work

On POSIX:
- verify session root is owned by current user;
- warn/fail on unsafe ownership;
- chmod root/session dirs to `0700`;
- chmod canonical session files to `0600`.

Avoid meaningless chmod assumptions on Windows.

---

## VC-AUD-037 — P3 — JSON/error response size limits are inconsistent
**Status:** CONFIRMED

Binary paths have explicit byte limits. General JSON and some `response.text()` paths are not uniformly bounded.

### Required work

Create one response-reader abstraction with:
- max bytes;
- expected content type;
- timeout/abort;
- safe error preview;
- JSON decode.

Apply endpoint-specific limits.

---

## VC-AUD-038 — P3 — Retry backoff has no jitter
**Status:** HARDENING

Current linear-ish retry waits can synchronize many clients during an outage.

Use bounded exponential backoff with jitter, while honoring server `Retry-After`.

---

## VC-AUD-039 — P3 — `models --type` lacks input validation
**Status:** CONFIRMED

Help advertises a closed enum, but arbitrary strings are accepted and simply filter to zero results.

### Required fix

Parse against:

```ts
const MODEL_TYPES = [
  'all','asr','embedding','image','music',
  'text','tts','upscale','inpaint','video'
] as const;
```

Return an actionable CLI error for invalid values.

### Sources

- Repo: `src/commands/models.ts`
- Official model type enum:
  `https://docs.venice.ai/api-reference/endpoint/models/list`

---

## VC-AUD-040 — P3 — Security policy is duplicated instead of declarative
**Status:** CONFIRMED ARCHITECTURAL DEBT

Tool declarations already know their risk, but a second hard-coded list independently re-classifies names.

This is the root cause of checkpoint and MCP misclassification.

### Required architecture

A tool should own:
- schema;
- base/dynamic risk;
- concurrency policy;
- workspace policy;
- network/external-side-effect policy;
- whether results may contain secrets;
- whether results may be persisted.

Example:

```ts
interface AgentTool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  classifyRisk(input: TInput): RiskAssessment;
  concurrency: 'parallel-read' | 'serialized';
  persistence: 'normal' | 'redact' | 'never';
  execute(input: TInput, context: ToolContext): Promise<ToolResult<TOutput>>;
}

interface RiskAssessment {
  level:
    | 'read'
    | 'write'
    | 'execute'
    | 'network'
    | 'external_side_effect'
    | 'destructive';
  workspaceBounded: boolean;
  reason: string;
}
```

Then the permission manager consumes the assessment; it does not reconstruct it.

---

# 9. Missing Agent Features Worth Adding After Correctness

These are not all bugs. They are the highest-value capabilities needed to move the CLI closer to mature agent CLIs such as Codex/Gemini/Kimi-style workflows.

## 9.1 Dynamic capability-driven tool availability

Do not show all tools to every model.

Build tool availability from:
- model function-call capability;
- vision/video support;
- web/X search support;
- structured-output support;
- current approval mode;
- MCP server health;
- platform support.

## 9.2 Parallel read-only tool execution

Only after VC-AUD-020 is addressed:
- parallelize independent reads/searches;
- serialize writes;
- serialize checkpoint-affecting work;
- cancel sibling reads if the turn is cancelled.

## 9.3 Dry-run / plan mode

Add:

```bash
venice agent --plan
```

It may inspect/read but cannot mutate or execute shell/external tools.

## 9.4 Explicit ephemeral mode

```bash
venice agent --ephemeral
```

No durable transcript/tool-result/session persistence.

## 9.5 Secret-aware command execution

Before shell/MCP execution:
- detect obvious secret-printing patterns;
- warn;
- redact output;
- never use the warning as the only control.

## 9.6 Rich model routing

Allow:

```bash
venice agent --model fastest
venice agent --model default
venice agent --require function-calling
venice agent --require code
venice agent --require e2ee
```

Resolve traits/capabilities dynamically.

## 9.7 API capability sync command

```bash
venice doctor api
venice doctor models
venice doctor mcp
venice doctor security
```

Report:
- spec commit/date;
- unsupported documented endpoints;
- configured model availability;
- stale model IDs;
- MCP trust policy;
- unsafe shell mode;
- session-directory permissions.

## 9.8 Tool-call budget and cost budget

Add separate controls:

```bash
--max-turns
--max-tool-calls
--max-network-calls
--max-cost-usd
```

Agent loops should stop with an explicit partial status, not silently behave as a normal completion.

## 9.9 Machine-readable event stream

Provide stable JSONL events for external orchestrators:

```bash
venice agent ... --events jsonl
```

Version the schema.

## 9.10 Resume compatibility/versioning

Persist:
- session schema version;
- CLI version;
- model;
- tool registry version;
- active MCP config hash.

Migrate or reject incompatible session formats explicitly.

---

# 10. Implementation Order

## Phase 0 — Reproduce and freeze baseline

```bash
git status --short
git rev-parse HEAD
node --version
npm --version

npm ci
npm run lint
npm run build
npm run test:compiled
npm audit --omit=dev
npm run pack:check
```

Capture output under:

```text
docs/audits/venice-cli-2026-08-16/baseline/
```

Do not modify production code until baseline evidence is stored.

## Phase 1 — Permission/security boundary

Fix in this order:

1. VC-AUD-003 declared-risk bypass.
2. VC-AUD-004 pattern approvals.
3. VC-AUD-002 MCP auto-approval.
4. VC-AUD-001 shell semantics.
5. VC-AUD-005 environment inheritance.
6. VC-AUD-006 persistence redaction.
7. VC-AUD-007 process-tree termination.
8. VC-AUD-014 checkpoint classification.

Run targeted security tests after every change.

## Phase 2 — Runtime reliability

Fix:
- stream cancellation/idle timeout;
- extra headers;
- SSE protocol errors;
- instruction-load warning/fail policy;
- model capability fail-closed;
- 429/Retry-After.

## Phase 3 — API source-of-truth

Create an API reference sync workflow.

Suggested ignored directory:

```text
docs/reference/venice-api-local/
```

`.gitignore`:

```gitignore
/docs/reference/venice-api-local/
```

Fetch:
- `swagger.yaml`;
- `llms.txt`;
- `llms-full.txt`;
- relevant API `.md` pages;
- `agents.md`;
- `skill.md`.

Record the source commit/hash in a small tracked manifest, not the full generated cache if maintainers prefer local-only docs.

## Phase 4 — API parity

Implement:
- traits;
- compatibility mappings;
- current chat controls;
- embeddings controls;
- Responses API alpha;
- x402 auth where intended.

## Phase 5 — CLI UX

Fix:
- dynamic completions;
- richer models view;
- capability filters;
- doctor commands.

## Phase 6 — CI/release

Fix:
- `.tsx` lint;
- completion parity test;
- OpenAPI drift gate;
- secret-redaction tests;
- action SHA pinning;
- fork publishing decision/metadata.

---

# 11. Concrete Regression Test Matrix

Create or expand tests for all of the following.

## Permissions

```text
suggest + read                    -> approval unless explicitly granted
auto-edit + read/write            -> allowed
auto-edit + shell                 -> approval required
auto + safe internal execute      -> policy-defined
auto + shell                      -> approval required
auto + unknown MCP                -> approval required
yolo + destructive               -> still explicit unless intentionally documented otherwise
pattern grant matching path       -> allowed
pattern grant nonmatching path    -> denied
pattern grant without matcher     -> rejected
```

## Shell

```text
cwd outside workspace             -> denied
relative cwd escaping             -> denied
symlink cwd escape                -> denied
shell in auto mode                -> prompts
environment output                -> secrets redacted
timeout child tree                -> no descendant survives
abort signal                      -> process tree terminates
stdout/stderr truncation          -> deterministic metadata reports truncation
```

## MCP

```text
unknown MCP tool                  -> external-side-effect approval
MCP read tool trusted by config   -> read policy
MCP mutation                      -> prompt
MCP delete                        -> destructive prompt
MCP server failure               -> typed event/error
MCP cancellation                 -> propagates
secret args/results              -> redacted from persistence
```

## Streaming

```text
headers arrive, body stalls       -> idle timeout
caller aborts                     -> reader/fetch terminate
UTF-8 split across chunks         -> correct decode
malformed SSE JSON                -> protocol error, not silent skip
[DONE]                            -> final usage emitted exactly once
tool-call deltas                  -> reconstructed deterministically
```

## Models/API

```text
models API down                   -> tool mode fails closed
function calling false            -> chat-only
function calling true             -> agent
supportsVideoInput false          -> video attachment rejected
response schema false             -> structured format blocked/warned
traits endpoint                   -> parsed
compatibility mapping             -> parsed
unknown model type                -> typed handling
```

## Sessions

```text
secret in tool output             -> not persisted
0600 files / 0700 dirs POSIX      -> enforced
corrupt session                   -> typed recovery path
cross-workspace resume            -> rejected
atomic write interruption         -> canonical state remains valid
schema-version migration          -> explicit
```

---

# 12. Example Permission Refactor Skeleton

This is intentionally a design example, not a blind patch.

```ts
export type RiskLevel =
  | 'read'
  | 'write'
  | 'execute'
  | 'network'
  | 'external_side_effect'
  | 'destructive';

export interface RiskAssessment {
  level: RiskLevel;
  workspaceBounded: boolean;
  containsPotentialSecrets?: boolean;
  reason: string;
}

export interface AgentTool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  assessRisk(input: TInput): RiskAssessment;
  execute(
    input: TInput,
    context: ToolContext
  ): Promise<ToolResult<TOutput>>;
}
```

Runtime:

```ts
const assessment = tool.assessRisk(input);

const approved = await permissions.isApproved(
  tool.name,
  input,
  assessment
);

if (!approved) {
  const decision = await permissions.requestApproval(
    tool.name,
    input,
    assessment
  );
  // validate decision scope/matcher before granting
}
```

MCP default:

```ts
assessRisk() {
  return {
    level: 'external_side_effect',
    workspaceBounded: false,
    containsPotentialSecrets: true,
    reason: 'Unclassified external MCP tool',
  };
}
```

Shell:

```ts
assessRisk() {
  return {
    level: 'execute',
    workspaceBounded: false,
    containsPotentialSecrets: true,
    reason: 'Shell commands execute with user OS privileges',
  };
}
```

This makes the UI tell the truth.

---

# 13. Example API Contract Types to Add

Do not treat this as exhaustive; generate/validate from current OpenAPI.

```ts
export interface ChatCompletionControls {
  frequency_penalty?: number;
  logprobs?: boolean;
  top_logprobs?: number;
  max_completion_tokens?: number;
  max_temp?: number;
  min_p?: number;
  min_temp?: number;
  n?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
  seed?: number;
  stop?: string | string[];
  stop_token_ids?: number[];
  temperature?: number;
  top_k?: number;
  top_p?: number;
  user?: string;
  store?: boolean;
  include?: string[];
  metadata?: Record<string, string>;
  parallel_tool_calls?: boolean;
}

export interface EmbeddingControls {
  dimensions?: number;
  encoding_format?: 'float' | 'base64';
  user?: string;
}
```

Validate numeric ranges from OpenAPI.

---

# 14. Completion Architecture Recommendation

Delete model inventories from generated shell scripts.

Introduce an internal completion command:

```bash
venice __complete commands
venice __complete options chat
venice __complete models text
venice __complete models image
venice __complete voices
venice __complete skills
venice __complete sessions
```

The shell script becomes a thin adapter.

Cache dynamic API data with:
- a short TTL;
- atomic writes;
- no API key in cache;
- stale-while-revalidate behavior.

This prevents the current “new CLI command exists but completion never learned it” class of bugs.

---

# 15. CI Gate Recommendation

Example target state:

```yaml
jobs:
  quality:
    steps:
      - npm ci
      - npm run lint
      - npm run build
      - npm run test:compiled
      - npm run test:security
      - npm run api:contract
      - npm run completions:check
      - npm run pack:check
      - npm audit --omit=dev
```

Platform matrix:

```text
Node 18 / Linux
Node 20 / Linux
Node 22 / Linux
Node 22 / macOS
Node 22 / Windows
```

Add focused Windows tests for:
- session atomic writes;
- path normalization;
- process-tree termination;
- shell quoting;
- completion generation if supported.

---

# 16. Release Acceptance Criteria

Do not call this audit resolved until all P0/P1 items meet these criteria:

- [ ] Shell behavior matches its documentation and approval semantics.
- [ ] `auto` does not silently authorize arbitrary MCP side effects.
- [ ] Runtime uses tool-owned risk assessments.
- [ ] Pattern grants cannot become accidental session-wide grants.
- [ ] Agent shell cannot trivially dump inherited API credentials.
- [ ] Persisted sessions redact secrets.
- [ ] Timed-out/aborted shell processes leave no descendants.
- [ ] Streaming can be cancelled and has an idle timeout.
- [ ] Non-stream extra headers have a regression test.
- [ ] Malformed SSE cannot be silently dropped.
- [ ] Unknown model capability fails closed.
- [ ] Instruction loading failure is visible.
- [ ] 429 handling honors retry exhaustion and `Retry-After`.
- [ ] All `.tsx` files are linted.
- [ ] Full `npm run verify` passes on Linux/macOS/Windows.
- [ ] `npm pack --dry-run` contains only intended artifacts.
- [ ] No tracked or packed secret/reference cache is introduced.

API-parity completion criteria:

- [ ] model traits supported;
- [ ] compatibility mappings supported;
- [ ] current model capability shape normalized;
- [ ] modern chat controls supported;
- [ ] embeddings controls supported;
- [ ] Responses API decision documented/implemented;
- [ ] x402 decision documented/implemented;
- [ ] completions are dynamic or generated from one source of truth;
- [ ] OpenAPI drift is tested in CI.

---

# 17. Validation Commands

Run from repo root:

```bash
set -euo pipefail

git status --short
git rev-parse HEAD

npm ci
npm run lint
npm run build
npm run test:compiled
npm audit --omit=dev
npm run pack:check
npm run verify
```

Recommended extra checks once added:

```bash
npm run test:security
npm run api:contract
npm run api:drift
npm run completions:check
```

Manual smoke:

```bash
node dist/index.js --help
node dist/index.js agent --help
node dist/index.js models --format json
node dist/index.js models --type text
node dist/index.js completions bash >/tmp/venice.bash
node dist/index.js completions zsh >/tmp/_venice
```

Security smoke in a disposable workspace:

```bash
tmp="$(mktemp -d)"
mkdir -p "$tmp/workspace"
printf 'outside\n' > "$tmp/outside.txt"

cd "$tmp/workspace"

# In safe modes, the agent must NOT be able to perform an unapproved shell read:
# cat ../outside.txt
#
# It also must not expose VENICE_API_KEY through `env`/`printenv`.
```

---

# 18. Documentation Updates Required With Code Changes

Update:
- `README.md`;
- `docs/permissions.md`;
- `docs/security.md`;
- `docs/tools.md`;
- `docs/mcp.md`;
- `docs/sessions.md`;
- `docs/architecture/agent-runtime.md`;
- relevant ADRs.

Specifically remove any wording that implies:
- shell is workspace-confined when it is not;
- `auto` is safe for arbitrary MCP tools;
- pattern approvals work if they remain unimplemented;
- sessions are privacy-safe without redaction.

---

# 19. Official Sources

## Audited repository

- `https://github.com/spearchucker667/venice-cli`
- Pinned audit commit:
  `https://github.com/spearchucker667/venice-cli/commit/6e2ba3653dd46241812fbd9ee91f6399993d73b4`

## Official Venice API

- API docs repo:
  `https://github.com/veniceai/api-docs`
- API specification:
  `https://docs.venice.ai/api-reference/api-spec`
- OpenAPI:
  `https://docs.venice.ai/swagger.yaml`
- Docs index:
  `https://docs.venice.ai/llms.txt`
- Full docs:
  `https://docs.venice.ai/llms-full.txt`
- Chat Completions:
  `https://docs.venice.ai/api-reference/endpoint/chat/completions`
- Models:
  `https://docs.venice.ai/api-reference/endpoint/models/list`
- Model Traits:
  `https://docs.venice.ai/api-reference/endpoint/models/traits`
- Compatibility Mapping:
  `https://docs.venice.ai/api-reference/endpoint/models/compatibility_mapping`
- Embeddings:
  `https://docs.venice.ai/api-reference/endpoint/embeddings/generate`
- Model catalog:
  `https://docs.venice.ai/models/overview`
- Model feature suffix:
  `https://docs.venice.ai/api-reference/endpoint/chat/model_feature_suffix`
- Reasoning:
  `https://docs.venice.ai/guides/features/reasoning-models`
- Structured responses:
  `https://docs.venice.ai/guides/features/structured-responses`

---

# 20. Audit Limitations

This was a live-repository static audit grounded to the commit identified above. The repository was inspected through GitHub’s connected repository interface and current official Venice documentation.

The execution environment used for this audit could not perform a direct network `git clone`, so the audit did **not** execute the repository’s test suite locally. For that reason:

- static code defects are marked **CONFIRMED** where the behavior follows directly from the code;
- runtime/environment-dependent items are explicitly marked for reproduction;
- implementation agent must execute the baseline commands before editing;
- if `main` moves beyond the pinned SHA, first diff the new HEAD and revalidate every affected finding.

Do not silently close a finding merely because a unit test currently passes. The security findings above are architectural contract problems and need adversarial regression tests.

---

# 21. Final Directive to Implementing Agent

Work evidence-first.

For every finding:

1. record the current behavior;
2. add a failing regression test where technically possible;
3. fix the underlying class of defect;
4. run the targeted test;
5. run full lint/build/test;
6. update docs;
7. record changed files and validation evidence.

Do not:
- weaken tests to obtain green CI;
- use regexes as a substitute for OS-level shell confinement;
- auto-trust arbitrary MCP tools;
- duplicate risk policy in another hard-coded name map;
- hard-code another short-lived model list;
- claim API parity without comparing to the pinned/current OpenAPI;
- expose API keys in logs, shell output, events, session JSON, fixtures, or snapshots;
- publish the fork under an upstream package identity without an explicit maintainer decision.

The highest-priority architectural outcome is simple:

> **The runtime must know what a tool can do, the permission layer must enforce that truth, and the UI/documentation must never promise a stronger boundary than the operating system actually enforces.**
