# Venice CLI — Kimi Code Functional Parity Design

## Source of truth

`docs/workorders/VENICE_CLI_KIMI_FUNCTIONAL_PARITY_HANDOFF_2026-08-16.md` is the authoritative parity audit. This design doc ratifies its scope and implementation order.

## Reference material

- `.reference/kimi-code/` is a dedicated source of inspiration and reference for Kimi Code CLI workflow contracts. It is read-only; implementation matches behavior at the workflow-contract level without copying source code.
- Recent file moves are recorded in the root `AGENTS.md`: legacy handoff docs moved to `docs/workorders/` and `swagger.yaml` moved to `docs/swagger.yaml`.

## Scope

Close the highest-value gaps between Venice CLI and current Kimi Code CLI workflow contracts, while preserving Venice-native differentiators (Venice API, media generation, privacy/E2EE/TEE, billing/keys, x402).

Do not copy Kimi source code. Match behavior at the workflow-contract level only.

## Architecture decisions

1. **Unified runtime mode object**
   ```ts
   interface RuntimeModeState {
     inputMode: 'agent' | 'shell';
     operatingMode: 'agent' | 'plan';
     permissionMode: 'suggest' | 'auto-edit' | 'auto' | 'yolo';
   }
   ```
2. **Single internal event stream** feeds TUI, `--output-format stream-json`, ACP, web server, and session replay.
3. **StoredSessionV2** adds `schemaVersion`, `parentSessionId`, `title`, `agentId`, and a typed `workspace` with `primaryRoot` and `additionalRoots`.
4. **Tool metadata** adds `planSafe` and `parallelSafe` flags to gate plan mode.

## Implementation order

Follow the phases defined in the workorder:

- **Phase A — core interaction:** real Plan Mode, Shell Mode, session startup flags, stream-json, session fork/title, structured slash registry.
- **Phase B — agent customization:** custom agents, subagent model selector, `--skills-dir`, `--add-dir`, compaction hints, external editor.
- **Phase C — integration:** ACP, doctor, export/import, upgrade.
- **Phase D — richer product:** hooks, plugins, themes/settings, tasks/goals, web UI/server.

## Starting point

Begin with **Phase A**. Within Phase A, implement items in the order listed above so each subsequent item can build on shared mode/state/event infrastructure.

## Acceptance

Use the acceptance matrix in the workorder. Before edits run `npm ci && npm run verify`. After each phase run the validation commands listed in the workorder.
