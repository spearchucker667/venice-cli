# Venice CLI Exhaustive Audit: Consolidated Report

This document aggregates the findings of the 14-agent parallel audit swarm against the `spearchucker667/venice-cli` repository.

## P0: Runtime Blockers

1. **Streaming Swallows Errors / Empty LLM Output (Streaming/Media/Runtime)**
   - *Issue*: `chatCompletionStream` parses SSE data but ignores `json.error`. If Venice API returns a mid-stream error (e.g. rate limit JSON payload after a 200 OK headers flush), the parser yields no output and exits silently. This is the root cause of the "streaming replies not returning LLM output" bug.
   - *Fix*: Check `if (json.error)` and throw a `VeniceApiError` in the parser.

## P1: High Severity

1. **Missing Try/Catch on Tool Execution (Runtime/Error Handling)**
   - *Issue*: `await tool.execute(...)` is not wrapped in a try/catch. Unhandled exceptions crash the entire `processTurns` loop instead of synthesizing a `ToolResult` error for the agent to recover.
   - *Fix*: Wrap `tool.execute` and return an error payload to the model.

2. **Stream Cancellation and Cleanup Incomplete (Streaming/Media)**
   - *Issue*: No `AbortSignal` cancellation path for streams. Also, `finally { reader.releaseLock(); }` throws a `TypeError` if a read is pending (e.g. on timeout), and the connection is not gracefully cancelled.
   - *Fix*: Implement `AbortSignal` support and call `reader.cancel().catch(() => {})`.

3. **Double Model Caching Breaks Refresh (Model Handling)**
   - *Issue*: `ModelCatalog` refresh delegates to `api.ts` which has its own module-level TTL cache. Thus, `force` refresh is ineffective.
   - *Fix*: Add a `bypassCache` option to `listModels` in the API layer.

4. **Context Compaction Drops History (Sessions/Context)**
   - *Issue*: `compact()` completely clears the conversation and file context arrays, dropping all LLM history context instead of summarizing or retaining the most recent turns.
   - *Fix*: Implement a semantic summarization LLM call and preserve the most recent N turns.

5. **Context Overflow Risk in Search Tools (Tools)**
   - *Issue*: `grep.ts` and `find.ts` return a `{ truncated: true }` metadata flag if results > 100, but do not actually slice the array. Returning 100,000 matches bloats the context.
   - *Fix*: Slice the results array (e.g., `results.slice(0, 100)`) before returning.

6. **Venice Media Tools Ignore Additional Roots (Tools)**
   - *Issue*: `resolveWorkspaceFile` in `io.ts` omits `context.workspace.additionalRoots`, restricting all media reading/writing strictly to the primary root.
   - *Fix*: Pass `additionalRoots` to the `WorkspaceManager` constructor in `io.ts`.

7. **SecretRedactor Ignores Configured Secrets (Config/Auth)**
   - *Issue*: `collectKnownSecrets` only retrieves `process.env.VENICE_API_KEY`. API keys configured via `~/.venice/config.json` are not redacted.
   - *Fix*: Append `config.api_key` to the `knownSecrets` array.

8. **Reasoning-Effort Profile Gap (Model Handling)**
   - *Issue*: `ModelProfile` lacks `supportsReasoningEffort`, and the agent path does not gate reasoning effort on capability (unlike the `chat` path).
   - *Fix*: Add the capability flag and gate reasoning effort properly.

## P2: Medium Severity

1. **Non-SSE Error Drop (Media)**: Uncaught stream drop if API returns a non-SSE error response (e.g. HTTP 200 JSON error). Check `content-type`.
2. **Process Tree Leak (MCP)**: JSON-RPC errors use `this.process?.kill('SIGTERM')` bypassing `this.stop()`, leaking child processes.
3. **Broken Permission UX (Runtime)**: `outside_workspace` session grants are unreachable because `isApproved` hardcodes a denial before checking grants.
4. **Tool Registry Inconsistency (MCP)**: `refreshServerTools` swallows errors, leaving broken tool definitions in the agent's context.
5. **UI Theme Dead End (Terminal UI)**: `/theme` command changes config but ink UI components hardcode colors instead of reading the theme context.
6. **Contradictory Unknown Command Logic (Terminal UI)**: `handleSlashCommand` intercepts typos instead of forwarding to the model as documented in `VC-KIMI-047`.
7. **Swallowed Startup Errors (Error Handling)**: `app.tsx:311` `runtime.start().catch(() => {})` silently swallows startup failures.
8. **Missing `/delete` Session Command (Sessions)**: Deletion is implemented in `SessionManager` but not exposed in slash commands.
9. **Inaccurate Token Estimation (Sessions)**: Uses naive byte-length heuristics instead of a proper tokenizer representation.
10. **Poor Error Contracts (Error Handling)**: Workorder error contract (cause/fix/debug) is not implemented for network and API errors.
11. **Config Validation and Precedence (Config)**: No JSON schema validation for `config.json`. Project config ignores non-auth keys like `output_format`.
12. **Model State Drift (Model Handling)**: Three parallel model-state copies (React, Runtime, Client) can drift.
13. **Swallowed Catalog Failures (Error Handling)**: Model/catalog fetch failures are silent, changing fallback behaviors invisibly.
14. **Test Suite Gaps (CI/CD / Tests)**: Missing `typecheck` script. Missing integration tests. Missing streaming failure mode tests.

## P3: Low Severity

1. **Docs and Parity Gaps**: Missing Plugin architecture (`plugins/` manifest loader). Missing Prompt system (`prompts/`). `/reload` command misrepresents action.
2. **Untested Commands**: 14 command modules have no test file (including `usage`, `search`, `import`).
3. **Hardcoded Model IDs**: Fallbacks like `kimi-k2-5` are hardcoded and not verified dynamically.
4. **Shell Tool Truncation**: `shellTool` output truncation is not signaled via metadata flag.
5. **Config Booleans**: Hardcoded boolean config conversions.
6. **Packaging**: `publish.yml` lacks an install-from-tarball smoke test, and `.npmignore` is duplicated config.
