# Venice CLI — Phase 0 Baseline Reconnaissance Report

## 1. Executive Summary

This report establishes the baseline operational and architectural status of the Venice CLI repository (`https://github.com/veniceai/venice-cli`) prior to continuing agent development milestones.

The repository is in a healthy, fully building, lint-passing, and test-passing state with comprehensive agent foundations spanning Phases 1 through 12.

---

## 2. Environment and Version Inventory

| Attribute | Value | Verification Command |
|---|---|---|
| **Repository** | `https://github.com/veniceai/venice-cli` | `git remote -v` |
| **Commit SHA** | `37eef5900b7d42db248a24107ce2a0c40a87362e` | `git rev-parse HEAD` |
| **Current Branch** | `main` | `git branch --show-current` |
| **Working Tree** | Clean (`nothing to commit, working tree clean`) | `git status` |
| **Node.js Version** | `v22.13.1` (Engine requirement: `>=18.0.0`) | `node -v` |
| **npm Version** | `10.9.2` | `npm -v` |
| **Operating System** | macOS (Darwin 24.6.0 arm64) | `uname -a` |
| **Package Version** | `veniceai-cli@2.1.0` | `package.json` |

---

## 3. Baseline Validation Results

### 3.1 Build (`npm run build`)
- **Status**: **PASS**
- **Compiler**: TypeScript 5.3.0 (`tsc`)
- **Errors**: 0
- **Output Target**: `dist/` (ES Modules)

### 3.2 Linter (`npm run lint`)
- **Status**: **PASS**
- **Linter**: ESLint 10.0.3 with `@typescript-eslint` parser
- **Scope**: `src/**/*.ts`
- **Warnings / Errors**: 0

### 3.3 Test Suite (`npm test`)
- **Status**: **PASS**
- **Test Runner**: Node.js built-in test runner (`node --test "dist/**/*.test.js"`)
- **Suites Passed**: 54 suites
- **Total Tests Passed**: 389 tests
- **Failures / Cancelled / Skipped**: 0 / 0 / 0
- **Duration**: ~36.6 seconds

### 3.4 Dependency Security Audit (`npm audit`)
- **Status**: **PASS**
- **Vulnerabilities**: 0 vulnerabilities detected

### 3.5 Package Distribution Hygiene (`npm pack --dry-run`)
- **Status**: **PASS**
- **Tarball Contents**: 402 files (clean production build without test files or MCP test servers)
- **Included Files**: `dist/`, `examples/`, `README.md`, `LICENSE`

---

## 4. Subsystem & Component Inventory

### 4.1 CLI & Command Layer (`src/commands/`)
- `agent.ts`: Workspace-aware agent entrypoint with interactive Ink TUI and noninteractive headless mode.
- `chat.ts`: Interactive and single-turn chat with Venice models, privacy modes, and E2EE.
- `search.ts`: Venice web search and scraping command line interface.
- `image.ts`: Image generation, editing, inpainting, and upscale.
- `video.ts`: AI video generation and image-to-video processing.
- `audio.ts`: Text-to-speech (TTS), voice cloning, and audio transcription.
- `music.ts`: Music and sound effect generation.
- `models.ts`: Dynamic model catalog discovery.
- `tee.ts`: TEE attestation verification and secure enclave operations.
- `mcp.ts`: Stdio MCP server lifecycle management (`list`, `add`, `remove`, `enable`, `disable`, `inspect`).
- `skills.ts`: Venice agent skill catalog inspection and management.
- `config.ts`, `history.ts`, `keys.ts`, `usage.ts`, `billing.ts`, `characters.ts`, `embeddings.ts`, `rpc.ts`, `augment.ts`.

### 4.2 Agent Subsystem (`src/agent/`)
- `runtime.ts`: Core `AgentRuntime` managing the iterative tool loop, validation, checkpoints, model turns, and lifecycle events.
- `types.ts`: Formal type definitions for `AgentState`, `AgentMessage`, `TodoItem`, `SubagentResult`, and `StructuredSummary`.
- `events.ts`: Strongly typed append-oriented event bus for UI and session auditability.
- `workspace.ts`: `WorkspaceManager` with canonical path resolution, symlink escape protection, and Git root detection.
- `permissions.ts`: `PermissionManager` with 4 operating modes (`suggest`, `auto-edit`, `auto`, `yolo`), risk classification, and approval prompts.
- `context.ts`: `ContextManager` enforcing dynamic model token limits, tiered message layers, and structured compaction.
- `sessions.ts`: `SessionManager` providing session persistence and replay via `~/.venice/sessions/<uuid>/`.
- `instructions.ts`: Precedence-aware instruction resolver loading `AGENTS.md`, `VENICE.md`, and `.venice/instructions.md`.
- `checkpoints.ts`: `CheckpointManager` providing parent-session file snapshots for undo/redo capabilities.
- `subagents.ts`: Bounded subagent runtime supporting read-only and write-capable execution.
- `validation.ts`: Dynamic test/lint/build detection and execution.

### 4.3 Tool Layer (`src/tools/`)
- **Filesystem**: `read_file`, `read_many_files`, `write_file`, `edit_file`, `apply_patch`, `list_directory`, `glob`.
- **Search**: `grep`, `find`.
- **Shell**: `shell` (controlled workspace execution with exit code preservation and timeout handling).
- **Git**: `git_status`, `git_diff`, `git_log`.
- **Agent Meta**: `todo_read`, `todo_write`, `ask_user`, `skill_list`, `skill_load`, `spawn_agent`, `checkpoint_list`, `checkpoint_undo`, `checkpoint_redo`.
- **Validation**: `run_validation`.
- **Venice-Native**: `web_search`, `web_scrape`, `generate_image`, `edit_image`, `upscale_image`, `remove_background`, `generate_video`, `image_to_video`, `transcribe_audio`, `text_to_speech`.

### 4.4 Model Context Protocol (`src/mcp/`)
- `client.ts`: Stdio JSON-RPC 2.0 client implementation.
- `manager.ts`: Server lifecycle, tool discovery, and error isolation.
- `config.ts`: Configuration loading from `~/.venice/mcp.json` and `.venice/mcp.json`.
- `adapter.ts`: Tool adapter wrapping MCP tools into `AgentTool` definitions under `mcp:<server>:<tool>`.

### 4.5 Skill System (`src/skills/`)
- `parser.ts`: Frontmatter parser extracting YAML metadata and tool constraints.
- `registry.ts`: Progressive skill discovery across `~/.config/venice/skills/` and `.venice/skills/`.

### 4.6 Terminal User Interface (`src/ui/`)
- React/Ink components: `App`, `Composer`, `Transcript`, `ToolCallEvent`, `ApprovalPrompt`, `StatusBar`, `ModelPicker`, `SessionPicker`.
- Event mapping, slash command parser, file mentions (`@file`), and shell passthrough (`!cmd`).

---

## 5. Identified Compatibility & Safety Constraints

1. **Deterministic Commands Preserved**: All original Venice API CLI subcommands (`chat`, `image`, `models`, `search`, etc.) remain fully functional and independent of the agent runtime.
2. **Workspace Isolation**: Filesystem access strictly respects the detected workspace root. Path traversal (`../`), external absolute paths, and escaping symlinks are rejected by default.
3. **No Unsanctioned Telemetry**: All agent operations, session records, and logs are stored exclusively in local filesystem storage.
4. **Secret Protection**: Session persistence redacts credentials and masks sensitive environment variables.
