# Venice CLI Agent Runtime — Phased Implementation Roadmap

## 1. Roadmap Overview

The transformation of Venice CLI into a workspace-aware, production-grade agent runtime follows a disciplined 13-phase architectural plan.

---

## 2. Phase Breakdown & Status Matrix

| Phase | Milestone | Scope / Deliverables | Status | Tests Added |
|---|---|---|---|---|
| **Phase 0** | Baseline & Reconnaissance | Inventory, baseline test verification, architecture specifications, risk register. | **COMPLETE** | Full suite verification |
| **Phase 1** | Agent Runtime Foundation | Core `AgentRuntime`, `ToolRegistry`, workspace detection, permissions, basic file tools. | **COMPLETE** | `src/agent/runtime.test.ts`, `src/tools/registry.test.ts` |
| **Phase 2** | Instructions & Auto-Context | `AGENTS.md` / `VENICE.md` resolver, model-aware context budgeting, validation detector. | **COMPLETE** | `src/agent/instructions.test.ts`, `src/agent/context.test.ts` |
| **Phase 3** | Venice Search & TUI Foundation | `web_search`, `web_scrape`, `generate_image`, event-driven renderer. | **COMPLETE** | `src/tools/venice/search.test.ts`, `src/ui/renderer.test.ts` |
| **Phase 4** | MCP Integration | Stdio JSON-RPC client, `McpManager`, config loader, namespaced adapter (`mcp:*`). | **COMPLETE** | `src/mcp/client.test.ts`, `src/mcp/manager.test.ts` |
| **Phase 5** | Checkpoints & Undo/Redo | `CheckpointManager`, automatic file snapshots, `checkpoint_undo`, `checkpoint_redo`. | **COMPLETE** | `src/agent/checkpoints.test.ts`, `src/tools/agent-meta/checkpoint-meta.test.ts` |
| **Phase 6** | Skill System | Frontmatter parser, progressive discovery (`~/.config/venice/skills`, `.venice/skills`), `skill_load`. | **COMPLETE** | `src/skills/parser.test.ts`, `src/skills/registry.test.ts` |
| **Phase 7** | Interactive Terminal UI | React/Ink TUI (`Composer`, `Transcript`, `StatusBar`, `ApprovalPrompt`), `@file` mentions. | **COMPLETE** | `src/ui/app.test.tsx`, `src/ui/composer.test.tsx` |
| **Phase 8** | Auto-Validation Loop | Automatic post-mutation test/lint/build execution, state integration. | **COMPLETE** | `src/agent/validation.test.ts`, `src/tools/validation/run.test.ts` |
| **Phase 9** | Read-Only Subagents | Bounded read-only subagent runtime, structured reports (`summary`, `findings`, `recommendations`). | **COMPLETE** | `src/agent/subagents.test.ts`, `src/tools/agent-meta/spawn-agent.test.ts` |
| **Phase 10** | Extended Venice Media Tools | `edit_image`, `upscale_image`, `remove_background`, `generate_video`, `image_to_video`, `audio` TTS/STT. | **COMPLETE** | `src/tools/venice/image.test.ts`, `src/tools/venice/video.test.ts`, `audio.test.ts` |
| **Phase 11** | Multi-Turn TUI & Pickers | Persistent interactive session lifecycle, `ModelPicker`, `SessionPicker`, slash commands. | **COMPLETE** | `src/ui/model-picker.test.tsx`, `src/ui/session-picker.test.tsx` |
| **Phase 12** | Write Subagents & Hardening | Write-capable subagents, session-scoped changed-file tracking, `@noble/curves` secp256k1 hardening. | **COMPLETE** | `src/agent/subagents.test.ts`, `src/lib/e2ee.test.ts` |
| **Phase 13** | Slash Commands & Scaffolding | `venice init`, slash handlers (`/diff`, `/review`, `/plan`, `/compact`, `/tools`, `/mcp`, `/skills`, `/permissions`, `/git`, `/init`). | **CURRENT** | `src/commands/init.test.ts`, `src/ui/slash-handlers.test.ts` |

---

## 3. Acceptance Verification Standard

Every milestone must satisfy:
1. **Zero Regression**: Existing Venice CLI subcommands (`chat`, `image`, `video`, `models`, `search`) pass without behavior changes.
2. **Deterministic Tests**: All unit and integration tests run offline without mandatory paid API keys using mock model fixtures.
3. **Strict Validation**: Clean TypeScript compilation (`npm run build`) and ESLint checks (`npm run lint`).
4. **Security Boundaries**: Filesystem isolation, path traversal defense, and permission controls strictly verified by automated tests.
