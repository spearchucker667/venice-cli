# Venice CLI Exhaustive Audit & Remediation

Resume Kimi's exhaustive audit of the `venice-cli` repository and execute remediation based on the findings.

## User Review Required

> [!IMPORTANT]
> The parallel audit swarm has successfully completed its analysis. I have consolidated the 14 reports into a master artifact ([Audit_Report_Consolidated.md](file:///Users/super_user/.gemini/antigravity/brain/88811c69-f3df-487c-be48-4639651f5f0d/Audit_Report_Consolidated.md)). 
> Please review the findings and the proposed remediation plan below, which targets the critical P0 and P1 issues. Do you approve proceeding with these fixes?

## Open Questions

> [!WARNING]
> 1. Do you want me to strictly address only P0 and P1 issues first, or should I also sweep through and fix the P2 issues in the same pass?
> 2. For Context Compaction (P1), the current behavior completely drops the conversation array. I plan to implement a retention mechanic to keep the last N turns. How many turns would you prefer to retain by default? (e.g., last 5 turns)

## Proposed Changes

### Phase 1: Audit Completion (Done)
- [x] Extract 6 completed audit reports from Kimi's session.
- [x] Launch 8 subagents to retry the quota-failed audit vectors.
- [x] Consolidate all 14 reports into a severity-ranked master audit document.

### Phase 2: Remediation of P0/P1 Issues (Pending Approval)

#### Streaming and API Reliability
- **MODIFY** `src/lib/api.ts`
  - Ensure `chatCompletionStream` checks for `json.error` inside SSE payloads and throws `VeniceApiError` instead of swallowing. (Fixes the "streaming replies not returning LLM output" bug).
  - Add `AbortSignal` support to the generator to enable stream cancellation.
  - Fix connection cleanup by using `reader.cancel().catch(() => {})` instead of `reader.releaseLock()`.

#### Error Handling & Agent Runtime
- **MODIFY** `src/agent/runtime.ts`
  - Wrap `await tool.execute(...)` in a `try/catch` block. Catch unhandled exceptions and synthesize them into a `ToolResult` error to prevent the entire agent loop from crashing.

#### Sessions & Context
- **MODIFY** `src/agent/context.ts`
  - Modify `compact()` to preserve the most recent N turns instead of blindly clearing `this.conversation = []` and `this.fileContext = []`.

#### Tool System Boundary Defenses
- **MODIFY** `src/tools/search/grep.ts` & `src/tools/search/find.ts`
  - Explicitly slice the results array (`results.slice(0, 100)`) before returning it to the agent, eliminating the context overflow risk.
- **MODIFY** `src/tools/venice/io.ts`
  - Pass `additionalRoots` from the agent context to the `WorkspaceManager` constructors, allowing media tools to access `--add-dir` directories.

#### Model Handling
- **MODIFY** `src/lib/api.ts` & `src/agent/model-catalog.ts`
  - Add a `bypassCache` option to `listModels` to resolve the double-caching issue making `force` refresh ineffective.
- **MODIFY** `src/types/index.ts` & `src/agent/model-profile.ts`
  - Add the `supportsReasoningEffort` flag to `ModelProfile` and correctly gate the `/effort` setting in the agent runtime path.

#### Config & Secrets
- **MODIFY** `src/lib/redactor.ts`
  - Safely retrieve and redact the configured `api_key` from `loadConfig()` instead of exclusively relying on `process.env`.

## Verification Plan

### Automated Tests
- Run `npm run test:compiled` to ensure the remediation doesn't break existing coverage.
- Add targeted unit tests for `chatCompletionStream` failure modes (e.g. `json.error` extraction) and `tool.execute()` exception handling in `runtime.test.ts`.
- Run `npm run verify` to pass all CI quality gates (lint, build, tests, types, security, parity, swagger drift).
