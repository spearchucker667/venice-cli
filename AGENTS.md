# Agent Guide — Venice CLI

This file is a living reference for AI coding agents working on the **Venice CLI** project. It assumes you know nothing about the repository. Read this first before making changes.

## 1. Project overview

**Venice CLI** (`@spearchucker667/venice-cli`) is a privacy-first AI agent and command-line toolkit for the [Venice AI](https://venice.ai) platform. It is published as an npm package and installs the `venice` binary.

The project is implemented in **TypeScript** as an **ES module** Node.js CLI. It exposes two primary usage modes:

- **Workspace agent** — started by the bare `venice` command (the default command). It is a long-running, tool-calling agent that can read and edit files, run shell commands, use Venice media/search APIs, connect to MCP servers, load skills, and spawn bounded subagents.
- **Direct commands** — deterministic subcommands for chat, image/video/audio generation, search, scraping, embeddings, TEE attestation, crypto RPC, billing, configuration, shell completions, etc.

The interactive agent uses an **Ink/React** terminal UI (`src/ui/`) and an event-driven runtime (`src/agent/`). The CLI talks to `https://api.venice.ai/api/v1` by default.

## 2. Technology stack

- **Runtime**: Node.js `>=18.0.0` (published CLI); Node.js `>=20.19.0` for the ESLint 10 dev toolchain.
- **Language**: TypeScript 5.3+ (strict mode, ESM, NodeNext module resolution).
- **Build**: `tsc` only — no bundler. Output goes to `dist/` and is published.
- **CLI framework**: Commander.
- **TUI**: Ink 5 + React 18.
- **HTTP client**: Native `fetch` (Node 18+).
- **Crypto**: `@noble/ciphers`, `@noble/curves`, `@noble/hashes` for E2EE.
- **JSON Schema validation**: `ajv` + `ajv-formats`.
- **Testing**: Node.js built-in test runner (`node --test`).
- **Linting**: ESLint 10 flat config with `@typescript-eslint`.

## 3. Project layout

```
venice-cli/
├── src/
│   ├── index.ts              # CLI entry point; registers all commands; default command is agent
│   ├── commands/             # Commander command implementations (one file per command area)
│   ├── agent/                # Agent runtime, context, permissions, sessions, checkpoints, subagents
│   ├── lib/                  # Shared API client, config, output formatting, E2EE, media helpers
│   ├── tools/                # Agent tool registry and tool implementations
│   │   ├── filesystem/       # read_file, write_file, edit_file, apply_patch, list_directory, glob
│   │   ├── search/           # grep, find
│   │   ├── shell/            # shell execution
│   │   ├── git/              # git status/diff/log
│   │   ├── agent-meta/       # todos, checkpoints, skills, ask_user, spawn_agent
│   │   ├── validation/       # run_validation tool
│   │   └── venice/           # Venice-native media/search tools
│   ├── mcp/                  # MCP config, manager, client, adapter
│   ├── skills/               # Skill discovery, parsing, and registry
│   ├── ui/                   # Ink TUI and event renderer
│   └── types/                # Shared TypeScript definitions
├── dist/                     # Compiled JavaScript (generated, published)
├── scripts/                  # Build/test/validation helper scripts
│   ├── run-tests.mjs         # Discovers compiled *.test.js and runs node --test
│   ├── api-drift-check.mjs   # Structural OpenAPI drift check against pinned upstream spec
│   └── completions-check.mjs # Verifies shell completions cover all top-level commands
├── docs/                     # Architecture, reference, and user-facing documentation
│   ├── workorders/           # Handoff and audit workorders
│   ├── superpowers/specs/    # Feature specs
│   └── superpowers/plans/    # Implementation plans
├── .reference/kimi-code/     # Read-only reference for Kimi Code CLI workflow contracts
├── package.json
├── tsconfig.json
└── eslint.config.mjs
```

## 4. Build, test, and validation commands

Install dependencies and build:

```bash
npm ci
npm run build        # tsc → dist/
```

Run the CLI locally without compiling:

```bash
npx tsx src/index.ts --help
npm run dev -- chat "hello"
```

Quality gates:

| Command | What it does |
|---------|--------------|
| `npm run lint` | ESLint over `src/**/*.{ts,tsx}`. |
| `npm run build` | Compile TypeScript to `dist/`. |
| `npm test` | `build` + `test:compiled` (all tests except security). |
| `npm run test:compiled` | Run compiled `*.test.js` files under `dist/` with `node --test`, excluding security tests. |
| `npm run test:security` | Run only compiled `security.test.js` files. |
| `npm run api:contract` | Fetch the pinned Venice OpenAPI spec and verify endpoint/field expectations. |
| `npm run completions:check` | Build completions and verify every top-level command is present. |
| `npm run pack:check` | `npm pack --dry-run --json` to validate publish contents. |
| `npm run verify` | Full gate: lint → build → test:compiled → test:security → completions:check → api:contract → `npm audit` → pack:check. |

Run tests directly against TypeScript source during development:

```bash
npx tsx --test "src/**/*.test.ts"
```

## 5. Runtime architecture

The agent runtime is event-driven and strictly decoupled from transport and UI:

1. **CLI entry** (`src/index.ts`) creates a Commander program and registers all command modules.
2. **Agent command** (`src/commands/agent.ts`, default command) detects the workspace root, loads MCP config, and either launches the Ink TUI or a headless `AgentRuntime`.
3. **AgentRuntime** (`src/agent/runtime.ts`) runs an iterative loop:
   - Build context messages.
   - Call the Venice chat-completion model.
   - Parse tool calls.
   - Route each tool call through the **PermissionManager** (`src/agent/permissions.ts`).
   - Execute tools from the **ToolRegistry** (`src/tools/registry.ts`).
   - Track changed files, run auto-validation, take checkpoints, compact context when needed, and persist session state.
4. **ContextManager** (`src/agent/context.ts`) layers system contract → project instructions (`AGENTS.md`, `VENICE.md`, `.venice/instructions.md`) → working memory → active skills → conversation/tool history.
5. **ToolRegistry** exposes every tool via a uniform `AgentTool<TInput, TOutput>` interface. Inputs are validated against JSON Schema with `ajv` before execution.
6. **WorkspaceManager** (`src/agent/workspace.ts`) enforces the workspace boundary: path canonicalization, traversal prevention, symlink escape defense, and mutation tracking.
7. **McpManager** (`src/mcp/manager.ts`) discovers external tools from MCP stdio servers and registers them under the `mcp:<server>:<tool>` namespace. On a `tools/list_changed` refresh failure the manager only records `state.error`; the runtime must unregister the stale `mcp:<server>:` prefix and emit `mcp_failed` so broken tool definitions don't linger.
8. **SkillRegistry** (`src/skills/registry.ts`) progressively loads skill instructions from `~/.config/venice/skills/` and `.venice/skills/`.

### Agent state

Key state lives in `src/agent/types.ts`:

- `status`: `idle | thinking | awaiting_approval | executing_tool | verifying | complete | failed | cancelled`
- `mode`: `{ inputMode, operatingMode, permissionMode }` (`src/agent/mode.ts`)
- `messages`, `todos`, `changedFiles`, `toolHistory`, `skillSummaries`, `activeSkills`, `subagentReports`, `lastValidation`

### Approval modes

Defined in `src/agent/permissions.ts`:

| Mode | Reads | Workspace edits | Shell | Network/MCP | Destructive |
|------|-------|-----------------|-------|-------------|-------------|
| `suggest` (default) | allow | prompt | prompt | prompt | prompt |
| `auto-edit` | allow | allow | prompt | prompt | prompt |
| `auto` | allow | allow | prompt | prompt | prompt |
| `yolo` | allow | allow | allow | allow | prompt |

`auto` auto-approves only positively-known-safe capabilities (read-only and structured write/execute tools). Raw shell is a high-power capability whose "safety" is only regex-estimated, so it is never auto-approved in `auto` — it requires a grant or explicit approval, with `yolo` as the explicit bypass (VCL-057).

`outside_workspace` risk is always denied without explicit approval, and destructive commands are always intercepted.

## 6. Configuration and environment

Configuration precedence (highest first):

1. CLI flags
2. Environment variables (`VENICE_API_KEY`, `NO_COLOR`, `X_SIGN_IN_WITH_X`)
3. Workspace config `.venice/config.json`
4. Global config `~/.venice/config.json`
5. Built-in defaults

Useful environment variables:

- `VENICE_API_KEY` — overrides any stored API key.
- `NO_COLOR` / `venice --no-color` — disables colored output.
- `X_SIGN_IN_WITH_X` — wallet-token alternative to API key.
- `VENICE_API_BASE_URL` — redirected to only in `NODE_ENV=test` (used by tests).

Workspace initialization scaffolds `.venice/config.json`, `.venice/instructions.md`, `.venice/mcp.json`, and `.venice/skills/` via `venice init`.

## 7. Adding commands and tools

### New direct command

1. Create `src/commands/<name>.ts` exporting `register<Name>Command(program: Command): void`.
2. Import and call it in `src/index.ts`.
3. Add README documentation and update shell completions in `src/commands/completions.ts`.
4. Add unit tests in `src/commands/<name>.test.ts`.

### New agent tool

1. Implement the tool under `src/tools/<category>/<tool-name>.ts` conforming to `AgentTool<TInput, TOutput>` (`src/tools/types.ts`).
2. Register it in `src/tools/registry.ts`.
3. Set `risk` to one of `read | write | execute | network | destructive`.
4. If the tool must be hidden in plan mode, set `planSafe: false` when registering.
5. Add unit tests covering valid execution, errors, and permission risk classification.

### New function-calling tool for chat

Add the tool definition to `BUILTIN_TOOLS` in `src/lib/tools.ts`, add the executor to `toolExecutors`, update completions, and document in README.

### New TUI slash command

Add metadata to `SLASH_COMMANDS` in `src/ui/slash-commands.ts` and a handler in `SLASH_HANDLERS` in `src/ui/slash-handlers.ts` (the two must stay in sync). `handleSlashCommand` at the bottom of `slash-handlers.ts` rebuilds the handler context from an **explicit allowlist** — a new `SlashHandlerContext` field must be added in BOTH the destructure near the bottom and the forwarded object, or it silently never reaches handlers. Injected test doubles (e.g. `deleteSession`, `refreshTheme`) belong in that same allowlist.

## 8. Code style and conventions

- **TypeScript**: strict mode. Avoid `any`; use proper types. Public functions should have JSDoc comments.
- **Formatting**: 2-space indentation, single quotes, trailing commas in multi-line structures.
- **Naming**:
  - Commands/options: lowercase, hyphenated (`--output-format`).
  - Variables/functions: `camelCase`.
  - Types/interfaces: `PascalCase`.
  - Constants: `UPPER_SNAKE_CASE`.
- **Error handling**: provide helpful, actionable messages; never expose API keys or tokens; handle network failures gracefully.
- **`VeniceApiError` constructor order is `(message, statusCode?, code?, retryAfter?)`** — passing a code as the 2nd arg silently lands in `statusCode`. In the SSE parser, a `json.error` throw must be rethrown from the malformed-frame `catch` (`if (err instanceof VeniceApiError) throw err`), otherwise it is re-wrapped as a generic `Error`.
- **UI theme has two token systems**: chalk tokens via `getTheme()` (`src/ui/theme.ts`) for string output/headless renderer, and Ink tokens via `getInkTheme()` + `useTheme()` (`src/ui/theme-context.tsx`) for `<Text color>`. `/theme` re-renders by calling `refreshTheme()` threaded from App state through the slash context.
- **Imports**: use `.js` extensions on relative TypeScript imports because the project uses NodeNext module resolution.
- **Commits**: use Conventional Commits — `feat(scope):`, `fix(scope):`, `docs(scope):`, `refactor(scope):`, `test(scope):`, `chore(scope):`.
- **Branches**: `feature/description`, `fix/description`, `docs/description`, `refactor/description`.

ESLint rules of note (see `eslint.config.mjs`):

- `@typescript-eslint/no-explicit-any` is off.
- Unused variables/parameters must start with `_` or they error.

## 9. Testing strategy

- Tests use the **Node.js built-in test runner** (`node:test` and `node:assert`).
- Test files are co-located with source as `*.test.ts` and compiled to `dist/**/*.test.js`.
- `scripts/run-tests.mjs` discovers compiled tests recursively and runs them with `node --test`.
- Tests mock `globalThis.fetch` for API tests and use temporary directories for filesystem tests.
- Tests must restore mocked globals and environment variables in a `finally` block.
- `~/.venice/config.json` and `~/.venice/sessions` paths are module-level constants (not env-redirectable). Tests must NOT call `setConfigValue`/`/theme <valid>` or real `SessionManager` writes — they clobber the user's actual config/sessions. Use injectable slash-context callbacks (`deleteSession`, `refreshTheme`) and test the pure `getInkTheme` instead.
- Security-focused tests live in files named `security.test.ts` and run separately via `npm run test:security`.
- Run the full verification gate before finishing work: `npm run verify`.

## 10. Security considerations

- **Secrets**: the API key is stored in `~/.venice/config.json` with mode `0600`; the config directory is `0700`. Keys are never logged.
- **Environment variables**: `VENICE_API_KEY` overrides config; `X_SIGN_IN_WITH_X` is the wallet-token alternative.
- **Workspace boundary**: all filesystem tools resolve realpaths, reject `../` traversal, and block symlinks that escape the workspace root.
- **Secret redaction**: `SecretRedactor` (`src/lib/redactor.ts`) sanitizes session transcripts and tool arguments before persistence.
- **No telemetry**: the CLI does not collect or send usage analytics.
- **E2EE/TEE**: client-side encryption uses ECDH + AES-GCM for E2EE-capable models; TEE attestation is verified for TEE models.
- **Subagent isolation**: subagents default to read-only; write-mode subagents get only bounded workspace read/edit tools and no shell/network/nested-subagent access.
- **Destructive commands**: always require explicit approval regardless of approval mode.

## 11. CI/CD and publishing

- **CI** (`.github/workflows/ci.yml`) runs on pushes and PRs to `main`:
  - Quality job: Node 22 on Ubuntu — `npm run verify`.
  - Platform job: Node 22 on Ubuntu, macOS, Windows — build + `test:compiled`.
  - Runtime job: Node 18, 20, 22 on Ubuntu — build + `test:compiled`.
- **Publish** (`.github/workflows/publish.yml`) triggers on GitHub release creation. It runs `npm run verify`, checks package identity and release-tag ↔ `package.json` version consistency, then runs a real `npm publish --access public` via OIDC trusted publishing (`id-token: write`, no `NODE_AUTH_TOKEN`). Trusted publishing requires npm ≥ 11.5.1 (the workflow upgrades npm). `package.json` also has a `prepare` script (build) so Git-source installs work, and `publishConfig` for public registry access.
- `npm run prepublishOnly` is wired to `npm run verify`, so publishing always runs the full gate.

## 12. Reference material and current work

- Read-only reference for Kimi Code CLI workflows: `.reference/kimi-code/`. **Do not edit files under `.reference/`.**
- `.omk/` at the repo root is gitignored agent project memory (agentmemory skill). It never enters VCS or the npm tarball; keep it that way.
- Current parity workorder: `docs/workorders/VENICE_CLI_KIMI_FUNCTIONAL_PARITY_HANDOFF_2026-08-16.md`.
- Architecture spec: `docs/AGENT_ARCHITECTURE.md`.
- Developer guide: `docs/development.md`.
- Permissions/security docs: `docs/permissions.md`, `docs/security.md`.
- Context/sessions/tools/MCP/skills docs: `docs/context.md`, `docs/sessions.md`, `docs/tools.md`, `docs/mcp.md`, `docs/skills.md`.
- API contract: `docs/swagger.yaml`.

---

Reply to users in the same language they use. When in doubt, keep instructions concrete, minimize scope, and run `npm run verify` before claiming any task is complete.
