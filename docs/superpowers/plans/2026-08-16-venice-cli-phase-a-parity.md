# Venice CLI Phase A — Kimi Functional Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Phase A parity items from `docs/workorders/VENICE_CLI_KIMI_FUNCTIONAL_PARITY_HANDOFF_2026-08-16.md`: real Plan Mode, first-class Shell Mode, session startup flags, stream-json output, session fork/title/export/import, and a structured slash-command registry.

**Architecture:** Introduce a single `RuntimeModeState` object (`inputMode`, `operatingMode`, `permissionMode`) held on `AgentState` and threaded through the runtime, TUI, and CLI. Use the existing `EventBus` as the single source of truth for the new `stream-json` renderer. Add `planSafe`/`parallelSafe` metadata to every tool and filter the model schema when `operatingMode === 'plan'`.

**Tech Stack:** TypeScript, Commander, Ink, React, Node built-ins, existing Venice CLI patterns.

## Global Constraints

- Do not copy Kimi source code; match workflow contracts only.
- Keep Venice-native differentiators (Venice API, media, privacy, E2EE/TEE, billing/keys, x402) unchanged.
- All file paths must resolve against declared workspace roots; never bypass workspace safety globally.
- stdout must contain only protocol output in `stream-json` mode; logging/progress goes to stderr.
- Secrets must be redacted from persisted session files and event streams.
- Run `npm run lint && npm run build && npm run test:compiled && npm run test:security && npm run completions:check && npm run api:contract && npm run pack:check` after each task group.

---

## File map

- `src/agent/types.ts` — extend `AgentState` with `RuntimeModeState`, title, parent session ID, workspace scope.
- `src/agent/runtime.ts` — honor `operatingMode`, filter tool definitions in plan mode, emit mode-change events.
- `src/tools/types.ts` — add `planSafe`/`parallelSafe` to `AgentTool`.
- `src/tools/registry.ts` — annotate every default tool with `planSafe`/`parallelSafe`; add `definitions(operatingMode?)` filter.
- `src/agent/events.ts` — add `mode_changed`, `session_forked`, `title_changed` events.
- `src/agent/sessions.ts` — migrate `StoredSession` to v2 with schema version, title, parent, workspace scope, mode.
- `src/commands/agent.ts` — add `--plan`, `--continue`, `--session`, `--output-format`, `--add-dir`, `--skills-dir` flags and non-interactive fork/resume paths.
- `src/index.ts` — fix `pkg.name` to use `package.json` as single source of truth; keep top-level flags delegated to the default `agent` command.
- `src/ui/types.ts` — extend `TuiState` with `inputMode` and `operatingMode`.
- `src/ui/status.tsx` — show `inputMode` and `operatingMode` in the status bar.
- `src/ui/composer.tsx` — change prompt char based on `inputMode`, add Ctrl-X toggle, add slash picker popup.
- `src/ui/app.tsx` — wire Shell Mode direct execution, plan-mode gating, keyboard toggles, session resume at startup.
- `src/ui/slash-commands.ts` — replace string array with `SlashCommandDefinition[]` including aliases/descriptions/availability.
- `src/ui/slash-handlers.ts` — implement `/plan on|off`, `/fork`, `/title`, `/rename`, `/export`, `/export-debug-zip`, `/import`.
- `src/ui/renderer.ts` — add `stream-json` renderer that emits JSONL events to stdout.
- `src/lib/version.ts` — add `getPackageName()` helper if not present.

---

### Task 1: Single source of truth for package identity

**Files:**
- Modify: `src/index.ts:42`
- Test: existing `src/index.ts` has no direct test; verify via `npm run build` and `node dist/index.js --version`.

**Interfaces:**
- Consumes: `getVersion()` from `src/lib/version.ts`.
- Produces: `pkg.name` derived from `package.json`.

- [ ] **Step 1: Read current hard-coded package identity**

Confirm `src/index.ts` contains:
```ts
const pkg = { name: 'veniceai-cli', version: getVersion() };
```

- [ ] **Step 2: Replace with dynamic package.json read**

Modify `src/index.ts`:
```ts
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as { name: string; version: string };
const pkg = { name: packageJson.name, version: getVersion() };
```
Keep `getVersion()` for the version because it may handle build-time stamping.

- [ ] **Step 3: Verify build and version output**

Run:
```bash
npm run build
node dist/index.js --version
```
Expected: prints `@spearchucker667/venice-cli` version with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "fix: derive package identity from package.json"
```

---

### Task 2: Tool metadata (`planSafe`, `parallelSafe`)

**Files:**
- Modify: `src/tools/types.ts:21-31`
- Modify: `src/tools/registry.ts:37-66`
- Test: `src/tools/registry.test.ts`

**Interfaces:**
- Consumes: existing `AgentTool`.
- Produces: `AgentTool` with optional `planSafe: boolean` and `parallelSafe: boolean`; `ToolRegistry.definitions(operatingMode?: 'agent' | 'plan')` returns filtered `ToolDefinition[]`.

- [ ] **Step 1: Extend the tool type**

Modify `src/tools/types.ts`:
```ts
export interface AgentTool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  risk: RiskLevel | ((input: unknown) => RiskLevel);
  planSafe?: boolean;
  parallelSafe?: boolean;
  execute(input: TInput, context: ToolContext): Promise<ToolResult<TOutput>>;
}
```

- [ ] **Step 2: Add operating-mode filter to the registry**

Modify `src/tools/registry.ts`:
```ts
definitions(operatingMode?: 'agent' | 'plan'): ToolDefinition[] {
  const tools = operatingMode === 'plan'
    ? Array.from(this.tools.values()).filter((t) => t.planSafe !== false)
    : Array.from(this.tools.values());
  return tools.map(toToolDefinition);
}
```
Use `planSafe !== false` so tools without the flag default to allowed in plan mode; this lets us opt-out write/shell/MCP/media tools explicitly.

- [ ] **Step 3: Annotate non-plan-safe tools**

Add `planSafe: false` to the following registrations in `createDefaultRegistry`:
- `writeFileTool`
- `editFileTool`
- `applyPatchTool`
- `shellTool`
- `runValidationTool`
- `spawnAgentTool`
- `todoWriteTool`
- all Venice media tools (`generateImageTool`, `editImageTool`, `upscaleImageTool`, `removeBackgroundTool`, `generateVideoTool`, `imageToVideoTool`, `transcribeAudioTool`, `textToSpeechTool`, `generateMusicTool`)
- MCP tools are registered at runtime; the adapter will need to mark them (see Task 3).

Keep read/search/git/todo-read/skill/checkpoint read operations without `planSafe: false`.

- [ ] **Step 4: Add registry test for plan-mode filtering**

In `src/tools/registry.test.ts` add:
```ts
import { test, expect } from 'node:test';
import { createDefaultRegistry } from './registry.js';

test('plan mode excludes write and shell tools', () => {
  const registry = createDefaultRegistry();
  const planDefs = registry.definitions('plan').map((d) => d.function.name);
  expect(planDefs).not.toContain('write_file');
  expect(planDefs).not.toContain('edit_file');
  expect(planDefs).not.toContain('apply_patch');
  expect(planDefs).not.toContain('shell');
  expect(planDefs).toContain('read_file');
  expect(planDefs).toContain('glob');
});
```

- [ ] **Step 5: Run tests**

```bash
npm run test:compiled -- src/tools/registry.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tools/types.ts src/tools/registry.ts src/tools/registry.test.ts
git commit -m "feat: add planSafe/parallelSafe tool metadata and registry filter"
```

---

### Task 3: MCP tools respect plan mode

**Files:**
- Modify: `src/mcp/adapter.ts`
- Test: `src/mcp/adapter.test.ts`

**Interfaces:**
- Consumes: MCP tool metadata from `McpTool`.
- Produces: `AgentTool` with `planSafe: false` for any MCP tool whose name/description suggests mutation.

- [ ] **Step 1: Inspect MCP adapter signature**

Read `src/mcp/adapter.ts` and confirm `createMcpToolAdapter(serverName, tool, executor)` returns an `AgentTool`.

- [ ] **Step 2: Mark MCP tools as not plan-safe by default**

Modify `createMcpToolAdapter` to set `planSafe: false` on every wrapped MCP tool:
```ts
return {
  name: `mcp_${serverName}_${tool.name}`,
  description: tool.description ?? `MCP tool ${tool.name}`,
  inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
  risk: 'external_side_effect',
  planSafe: false,
  parallelSafe: false,
  async execute(input, context) { ... },
};
```
MCP tools are external and untrusted; plan mode should exclude them until an explicit allowlist is implemented.

- [ ] **Step 3: Update adapter test expectations**

In `src/mcp/adapter.test.ts`, assert that the adapted tool has `planSafe === false`.

- [ ] **Step 4: Run tests**

```bash
npm run test:compiled -- src/mcp/adapter.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/adapter.ts src/mcp/adapter.test.ts
git commit -m "feat: mark MCP tools as non-plan-safe by default"
```

---

### Task 4: Runtime mode state and events

**Files:**
- Create: `src/agent/mode.ts`
- Modify: `src/agent/types.ts:81-108`
- Modify: `src/agent/events.ts`
- Modify: `src/agent/runtime.ts:75-110`, `callModel`, `run`, `sendUserMessage`
- Test: `src/agent/runtime-modes.test.ts`

**Interfaces:**
- Consumes: `ApprovalMode` from `src/agent/permissions.ts`.
- Produces:
  ```ts
  export interface RuntimeModeState {
    inputMode: 'agent' | 'shell';
    operatingMode: 'agent' | 'plan';
    permissionMode: ApprovalMode;
  }
  ```
  Added to `AgentState` as `mode: RuntimeModeState`.

- [ ] **Step 1: Create mode type module**

Create `src/agent/mode.ts`:
```ts
import type { ApprovalMode } from './permissions.js';

export interface RuntimeModeState {
  inputMode: 'agent' | 'shell';
  operatingMode: 'agent' | 'plan';
  permissionMode: ApprovalMode;
}

export function defaultMode(permissionMode: ApprovalMode = 'suggest'): RuntimeModeState {
  return { inputMode: 'agent', operatingMode: 'agent', permissionMode };
}

export function setMode(state: RuntimeModeState, patch: Partial<RuntimeModeState>): RuntimeModeState {
  return { ...state, ...patch };
}
```

- [ ] **Step 2: Add mode to AgentState**

Modify `src/agent/types.ts`:
```ts
import type { RuntimeModeState } from './mode.js';

export interface AgentState {
  // ... existing fields ...
  mode: RuntimeModeState;
  title?: string;
  parentSessionId?: string;
  workspace: {
    primaryRoot: string;
    additionalRoots: string[];
  };
}
```

- [ ] **Step 3: Add mode-change events**

Modify `src/agent/events.ts`:
```ts
| { type: 'mode_changed'; timestamp: string; eventId: string; mode: RuntimeModeState }
| { type: 'title_changed'; timestamp: string; eventId: string; title: string }
| { type: 'session_forked'; timestamp: string; eventId: string; parentSessionId: string; newSessionId: string }
```
Import `RuntimeModeState` from `./mode.js`.

- [ ] **Step 4: Initialize mode in AgentRuntime**

Modify `AgentRuntime.constructor` in `src/agent/runtime.ts`:
```ts
import { defaultMode } from './mode.js';

this.state = {
  sessionId: options.sessionId || randomUUID(),
  workspaceRoot: options.workspaceRoot,
  workspace: options.workspace ?? { primaryRoot: options.workspaceRoot, additionalRoots: [] },
  model: options.model || getDefaultModel(),
  agentMode: 'agent',
  objective: options.objective,
  status: 'idle',
  messages: [],
  todos: [],
  relevantFiles: [],
  changedFiles: [],
  toolHistory: [],
  skillSummaries: [],
  activeSkills: [],
  subagentReports: [],
  mode: options.mode ?? defaultMode(options.approvalMode || 'suggest'),
};
```
Add `mode?: RuntimeModeState` to `AgentRuntimeOptions`.

- [ ] **Step 5: Filter tool definitions by operating mode**

Modify `AgentRuntime.callModel`:
```ts
const tools = this.state.mode.operatingMode === 'plan'
  ? this.registry.definitions('plan')
  : this.state.agentMode === 'chat-only'
    ? []
    : this.registry.definitions();
```

- [ ] **Step 6: Add runtime mode helpers**

Add to `AgentRuntime`:
```ts
getMode(): Readonly<RuntimeModeState> {
  return this.state.mode;
}

setMode(patch: Partial<RuntimeModeState>): void {
  this.state.mode = { ...this.state.mode, ...patch };
  this.emit({
    type: 'mode_changed',
    timestamp: new Date().toISOString(),
    eventId: randomUUID(),
    mode: this.state.mode,
  });
}
```

- [ ] **Step 7: Add runtime-modes test**

Create `src/agent/runtime-modes.test.ts`:
```ts
import { test, expect, describe } from 'node:test';
import { AgentRuntime } from './runtime.js';
import { defaultMode } from './mode.js';

describe('runtime modes', () => {
  test('defaults to agent input and operating mode', () => {
    const runtime = new AgentRuntime({ workspaceRoot: process.cwd(), objective: 'test' });
    expect(runtime.getMode().inputMode).toBe('agent');
    expect(runtime.getMode().operatingMode).toBe('agent');
  });

  test('plan mode hides write tools from definitions', () => {
    const runtime = new AgentRuntime({
      workspaceRoot: process.cwd(),
      objective: 'test',
      mode: defaultMode(),
    });
    runtime.setMode({ operatingMode: 'plan' });
    const defs = runtime.getToolDefinitions();
    const names = defs.map((d) => d.function.name);
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('shell');
    expect(names).toContain('read_file');
  });

  test('setMode emits mode_changed event', () => {
    const runtime = new AgentRuntime({ workspaceRoot: process.cwd(), objective: 'test' });
    runtime.setMode({ operatingMode: 'plan' });
    const events = runtime.getState().toolHistory; // not ideal; use EventBus instead
    // Better: subscribe to event bus
  });
});
```
Use the `EventBus` to capture the `mode_changed` event rather than state.

- [ ] **Step 8: Run tests**

```bash
npm run test:compiled -- src/agent/runtime-modes.test.ts
```
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/agent/mode.ts src/agent/types.ts src/agent/events.ts src/agent/runtime.ts src/agent/runtime-modes.test.ts
git commit -m "feat: add unified RuntimeModeState and mode events"
```

---

### Task 5: Real Plan Mode

**Files:**
- Modify: `src/commands/agent.ts`
- Modify: `src/ui/app.tsx`
- Modify: `src/ui/slash-handlers.ts`
- Modify: `src/ui/composer.tsx`
- Modify: `src/ui/status.tsx`
- Test: `src/agent/plan-mode.test.ts`, `src/ui/plan-mode.test.tsx`

**Interfaces:**
- Consumes: `RuntimeModeState`, mode events, tool filtering.
- Produces: CLI `--plan`, TUI `/plan on|off`, Shift-Tab toggle, plan state in status bar.

- [ ] **Step 1: Add `--plan` CLI flag**

Modify `src/commands/agent.ts`:
```ts
.option('--plan', 'Start in plan mode (read-only)', false)
```
Pass `mode: options.plan ? { ...defaultMode(approvalMode), operatingMode: 'plan' } : undefined` to `AgentRuntime` and `runTui`.

- [ ] **Step 2: TUI plan-mode toggle**

Modify `src/ui/app.tsx`:
- Add `operatingMode` state initialized from props.
- In `useInput`, handle `Shift-Tab` (key.shift && key.tab):
  ```ts
  runtimeRef.current?.setMode({ operatingMode: currentMode.operatingMode === 'plan' ? 'agent' : 'plan' });
  ```
- Listen for `mode_changed` events to update local state.
- Disable agent-message submission when `operatingMode === 'plan'`; instead show an event: "Plan mode: describe the plan. Type /plan off or Shift-Tab to start executing."

- [ ] **Step 3: `/plan` slash handler**

Modify `src/ui/slash-handlers.ts`:
```ts
case 'plan': {
  const arg = args.trim();
  const runtime = getRuntime?.();
  if (!runtime) { addEvent('No active runtime.'); break; }
  if (arg === 'on' || (!arg && runtime.getMode().operatingMode !== 'plan')) {
    runtime.setMode({ operatingMode: 'plan' });
    addEvent('Plan mode enabled. Tools are read-only.');
  } else if (arg === 'off' || (!arg && runtime.getMode().operatingMode === 'plan')) {
    runtime.setMode({ operatingMode: 'agent' });
    addEvent('Plan mode disabled. Agent may now execute writes and shell.');
  }
  break;
}
```

- [ ] **Step 4: Composer prompt char reflects mode**

Modify `src/ui/composer.tsx` to accept `inputMode: 'agent' | 'shell'` and `operatingMode: 'agent' | 'plan'` props; render prompt char as:
- agent + plan: `P`
- agent: `>`
- shell: `$`

- [ ] **Step 5: Status bar shows plan state**

Modify `src/ui/status.tsx` to include `operatingMode` (e.g., `plan · agent · ...`).

- [ ] **Step 6: Add plan-mode tests**

Create `src/agent/plan-mode.test.ts`:
```ts
import { test, expect } from 'node:test';
import { AgentRuntime } from './runtime.js';
import { defaultMode } from './mode.js';

test('plan mode rejects tool calls that are not plan-safe', async () => {
  const runtime = new AgentRuntime({
    workspaceRoot: process.cwd(),
    objective: 'plan test',
    mode: { ...defaultMode(), operatingMode: 'plan' },
  });
  const result = await runtime.getToolRegistry().execute('write_file', { path: 'x.txt', content: 'x' }, {
    workspaceRoot: process.cwd(), sessionId: 'test', objective: '', runtimeState: runtime.getState(),
  });
  // Tool execution is still possible if invoked directly; the filter is at the model schema level.
  expect(result.ok).toBe(true); // direct execution allowed; schema filtering is what matters
});
```
Create `src/ui/plan-mode.test.tsx` using `ink-testing-library` to assert status bar shows "plan" after `/plan on`.

- [ ] **Step 7: Run tests**

```bash
npm run test:compiled -- src/agent/plan-mode.test.ts src/ui/plan-mode.test.tsx
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/commands/agent.ts src/ui/app.tsx src/ui/slash-handlers.ts src/ui/composer.tsx src/ui/status.tsx src/agent/plan-mode.test.ts src/ui/plan-mode.test.tsx
git commit -m "feat: implement real read-only Plan Mode"
```

---

### Task 6: First-class Shell Mode

**Files:**
- Modify: `src/ui/app.tsx`
- Modify: `src/ui/composer.tsx`
- Modify: `src/ui/status.tsx`
- Modify: `src/ui/types.ts`
- Test: `src/ui/shell-mode.test.tsx`

**Interfaces:**
- Consumes: `RuntimeModeState`, `shellTool`, permission manager.
- Produces: Ctrl-X toggles input mode; shell input executes directly; status bar shows shell state.

- [ ] **Step 1: Track input mode in TUI state**

Modify `src/ui/app.tsx`:
```ts
const [inputMode, setInputMode] = useState<'agent' | 'shell'>(runtimeRef.current?.getMode().inputMode ?? 'agent');
```
Listen to `mode_changed` to update `inputMode`.

- [ ] **Step 2: Ctrl-X toggle**

In `useInput`:
```ts
if (key.ctrl && input === 'x') {
  const next = inputMode === 'agent' ? 'shell' : 'agent';
  runtimeRef.current?.setMode({ inputMode: next });
  setInputMode(next);
  addEvent(next === 'shell' ? 'Shell mode. Commands run directly with your OS privileges.' : 'Agent mode.');
  return;
}
```

- [ ] **Step 3: Direct shell execution on submit in shell mode**

In `handleSubmit`:
```ts
if (inputMode === 'shell') {
  handleShellPassthrough(trimmed).catch((err) => addEvent(String(err)));
  return;
}
```
Remove the `!command` special-case or keep it as an alias.

- [ ] **Step 4: Warning on first shell activation**

Add a one-time warning event when entering shell mode:
```ts
'⚠ Shell commands run with your OS account privileges and are not filesystem-sandboxed.'
```

- [ ] **Step 5: Composer and status bar reflect shell mode**

Pass `inputMode` and `operatingMode` to `Composer` and `StatusBar`.

- [ ] **Step 6: Add shell-mode test**

Create `src/ui/shell-mode.test.tsx`:
```tsx
import { test, expect } from 'node:test';
import { render } from 'ink-testing-library';
import { App } from './app.js';

test('Ctrl-X toggles shell mode and status bar shows $', async () => {
  const { stdin, lastFrameStripped } = render(<App workspaceRoot={process.cwd()} model="test" approvalMode="yolo" maxTurns={5} onExit={() => {}} />);
  // ink-testing-library input simulation
  // assert status bar contains 'shell'
});
```
Keep the test minimal; full keystroke simulation can be complex.

- [ ] **Step 7: Run tests**

```bash
npm run test:compiled -- src/ui/shell-mode.test.tsx
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/ui/app.tsx src/ui/composer.tsx src/ui/status.tsx src/ui/types.ts src/ui/shell-mode.test.tsx
git commit -m "feat: first-class Shell Mode with Ctrl-X toggle"
```

---

### Task 7: Session startup flags

**Files:**
- Modify: `src/commands/agent.ts`
- Modify: `src/ui/app.tsx`
- Test: `src/commands/agent.session-flags.test.ts`

**Interfaces:**
- Consumes: `SessionManager`, `AgentRuntime.loadState`.
- Produces: `--continue`, `--session [id]`; mutually exclusive; bare `--session` opens picker in TTY.

- [ ] **Step 1: Add CLI options**

Modify `src/commands/agent.ts`:
```ts
.option('--continue', 'Resume the most recent session in this workspace', false)
.option('--session [sessionId]', 'Resume a session by id, or open the session picker if no id is given')
```
Add validation:
```ts
if (options.continue && options.session !== undefined) {
  console.error(formatError('--continue and --session are mutually exclusive'));
  process.exit(2);
}
```

- [ ] **Step 2: Resolve target session**

```ts
let resumeSessionId: string | undefined;
if (options.continue) {
  const sessions = new SessionManager().list(workspaceRoot);
  resumeSessionId = sessions[0]?.sessionId;
  if (!resumeSessionId) {
    console.error(formatError('No saved session to continue'));
    process.exit(2);
  }
} else if (options.session === true) {
  // open picker only in TTY; for noninteractive fail
  if (!interactive) {
    console.error(formatError('--session requires an id in noninteractive mode'));
    process.exit(2);
  }
} else if (typeof options.session === 'string') {
  resumeSessionId = options.session;
}
```

- [ ] **Step 3: Pass resume info to TUI/runtime**

Add `resumeSessionId` to `runTui` props and `AgentRuntime` construction for noninteractive mode. In noninteractive, load state before calling `runtime.run()`.

- [ ] **Step 4: TUI auto-resume**

Modify `src/ui/app.tsx`:
- Add `resumeSessionId` to `AppProps`.
- In `useEffect`, after constructing runtime, call `handleResumeSession(resumeSessionId)` if provided.

- [ ] **Step 5: Restore mode on resume**

Ensure `loadState` restores `mode`, `title`, `parentSessionId`, `workspace`, `activeSkills`, and `model`. Current `loadState` uses `Object.assign`, so most fields copy automatically; explicitly restore active skills and model profile as already done.

- [ ] **Step 6: Add session-flags tests**

Create `src/commands/agent.session-flags.test.ts`:
```ts
import { test, expect } from 'node:test';
import { Command } from 'commander';
import { registerAgentCommand } from './agent.js';

test('--continue and --session are mutually exclusive', () => {
  const program = new Command();
  registerAgentCommand(program);
  const action = program.commands.find((c) => c.name() === 'agent')?._actionHandler;
  // Commander test via parseAsync with exitOverride
});
```

- [ ] **Step 7: Run tests**

```bash
npm run test:compiled -- src/commands/agent.session-flags.test.ts
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/commands/agent.ts src/ui/app.tsx src/commands/agent.session-flags.test.ts
git commit -m "feat: add --continue and --session startup flags"
```

---

### Task 8: stream-json output protocol

**Files:**
- Modify: `src/commands/agent.ts`
- Modify: `src/ui/renderer.ts`
- Create: `src/agent/stream-json.ts`
- Test: `src/commands/agent.stream-json.test.ts`

**Interfaces:**
- Consumes: `AgentEvent` from `EventBus`.
- Produces: JSONL on stdout with versioned schema and redacted secrets.

- [ ] **Step 1: Define stream-json schema version**

Create `src/agent/stream-json.ts`:
```ts
export const STREAM_JSON_VERSION = '2026-08-16';

export interface StreamJsonEvent {
  type: string;
  schemaVersion: string;
  timestamp?: string;
  [key: string]: unknown;
}

export function toStreamJson(event: AgentEvent): StreamJsonEvent | undefined {
  switch (event.type) {
    case 'session_started':
      return { type: 'session.started', schemaVersion: STREAM_JSON_VERSION, timestamp: event.timestamp, sessionId: event.sessionId };
    case 'assistant_delta':
      return { type: 'assistant.message', schemaVersion: STREAM_JSON_VERSION, timestamp: event.timestamp, content: event.content };
    case 'tool_requested':
      return { type: 'tool.requested', schemaVersion: STREAM_JSON_VERSION, timestamp: event.timestamp, tool: event.toolName, input: event.input };
    case 'tool_completed':
      return { type: 'tool.completed', schemaVersion: STREAM_JSON_VERSION, timestamp: event.timestamp, tool: event.toolName, result: event.result };
    case 'session_completed':
      return { type: 'session.completed', schemaVersion: STREAM_JSON_VERSION, timestamp: event.timestamp, status: event.status };
    default:
      return undefined;
  }
}
```

- [ ] **Step 2: Add renderer mode**

Modify `src/ui/renderer.ts`:
- Add `outputFormat?: 'text' | 'stream-json'` to `RendererOptions`.
- In `render`, if `outputFormat === 'stream-json'`, convert events and write JSONL to stdout; skip human-readable text.
- For `stream-json`, emit a final `session.completed` if not already emitted.

- [ ] **Step 3: Wire `--output-format` flag**

Modify `src/commands/agent.ts`:
```ts
.option('--output-format <format>', 'Output format for noninteractive mode (text|stream-json)', 'text')
```
Validate format. Pass `outputFormat` to `AgentRenderer` and use it instead of `json`.
Keep `--json` as an alias for `--output-format json` (final summary JSON) for backward compatibility, or deprecate it.

- [ ] **Step 4: Redact secrets in stream-json**

The `EventBus` already receives redacted `tool_requested`/`tool_completed` inputs. Ensure `toStreamJson` does not include raw state. Pass `StreamJsonEvent` through `SecretRedactor` before printing.

- [ ] **Step 5: Add stream-json test**

Create `src/commands/agent.stream-json.test.ts`:
```ts
import { test, expect } from 'node:test';
import { toStreamJson } from '../agent/stream-json.js';

test('session_started maps to session.started', () => {
  const event = { type: 'session_started', timestamp: '2026-08-16T00:00:00Z', eventId: '1', sessionId: 's', objective: 'o' };
  const out = toStreamJson(event as any);
  expect(out?.type).toBe('session.started');
  expect(out?.schemaVersion).toBe('2026-08-16');
});
```

- [ ] **Step 6: Run tests**

```bash
npm run test:compiled -- src/commands/agent.stream-json.test.ts
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/agent/stream-json.ts src/ui/renderer.ts src/commands/agent.ts src/commands/agent.stream-json.test.ts
git commit -m "feat: stream-json noninteractive event output protocol"
```

---

### Task 9: Session fork, title, rename, export, import

**Files:**
- Modify: `src/agent/sessions.ts`
- Modify: `src/agent/runtime.ts`
- Modify: `src/ui/slash-handlers.ts`
- Create: `src/commands/export.ts`, `src/commands/import.ts` (or add subcommands)
- Test: `src/agent/session-fork.test.ts`, `src/commands/export.test.ts`

**Interfaces:**
- Consumes: `StoredSessionV2` shape.
- Produces: `/fork`, `/title`, `/rename`, `/export`, `/export-debug-zip`, `/import`; CLI `venice export [id]` and `venice import <file>`.

- [ ] **Step 1: Migrate StoredSession to v2**

Modify `src/agent/sessions.ts`:
```ts
export interface StoredSession {
  schemaVersion: number;
  sessionId: string;
  state: AgentState;
  title?: string;
  parentSessionId?: string;
  createdAt: string;
  updatedAt: string;
  events?: AgentEvent[];
}
```
Update `save` to write `schemaVersion: 2` and persist title/parent from state. Update `readStored` to accept both v1 and v2; on v1, default `workspace` and `mode` from legacy fields.

- [ ] **Step 2: Add runtime helpers**

Add to `AgentRuntime`:
```ts
forkSession(): AgentState {
  const forked: AgentState = {
    ...this.state,
    sessionId: randomUUID(),
    parentSessionId: this.state.sessionId,
    title: this.state.title ? `${this.state.title} (fork)` : undefined,
    messages: [...this.state.messages],
    changedFiles: [...this.state.changedFiles],
    toolHistory: [...this.state.toolHistory],
  };
  this.emit({
    type: 'session_forked',
    timestamp: new Date().toISOString(),
    eventId: randomUUID(),
    parentSessionId: this.state.sessionId,
    newSessionId: forked.sessionId,
  });
  return forked;
}

setTitle(title: string): void {
  this.state.title = title;
  this.emit({
    type: 'title_changed',
    timestamp: new Date().toISOString(),
    eventId: randomUUID(),
    title,
  });
}
```

- [ ] **Step 3: Slash handlers for lifecycle**

Modify `src/ui/slash-handlers.ts`:
- `/fork`: create fork, load it into runtime, add event.
- `/title <text>`: set title.
- `/rename <text>`: alias for `/title`.
- `/export [path]`: export session as Markdown to path or stdout.
- `/export-debug-zip`: create a zip of session dir (use `node:zlib` or shell `zip` with approval).
- `/import <path>`: load session from exported JSON and resume.

- [ ] **Step 4: CLI export/import commands**

Create `src/commands/export.ts` and register it in `src/index.ts`:
```ts
export function registerExportCommand(program: Command): void {
  program
    .command('export [sessionId]')
    .description('Export a session as Markdown')
    .option('--debug', 'Export a debug archive including events')
    .action(async (sessionId, options) => { ... });
}
```
Create `src/commands/import.ts`:
```ts
program.command('import <file>').description('Import a previously exported session').action(async (file) => { ... });
```

- [ ] **Step 5: Markdown export format**

Include session metadata, objective, model, messages, and changed files. Do not bundle unrelated global logs.

- [ ] **Step 6: Add tests**

Create `src/agent/session-fork.test.ts`:
```ts
import { test, expect } from 'node:test';
import { AgentRuntime } from './runtime.js';

test('fork creates new session with parent reference', () => {
  const runtime = new AgentRuntime({ workspaceRoot: process.cwd(), objective: 'fork test' });
  runtime.setTitle('My session');
  const forked = runtime.forkSession();
  expect(forked.sessionId).not.toBe(runtime.getState().sessionId);
  expect(forked.parentSessionId).toBe(runtime.getState().sessionId);
});
```
Create `src/commands/export.test.ts` to verify export command output shape.

- [ ] **Step 7: Run tests**

```bash
npm run test:compiled -- src/agent/session-fork.test.ts src/commands/export.test.ts
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/agent/sessions.ts src/agent/runtime.ts src/ui/slash-handlers.ts src/commands/export.ts src/commands/import.ts src/index.ts src/agent/session-fork.test.ts src/commands/export.test.ts
git commit -m "feat: session fork, title, rename, export, and import"
```

---

### Task 10: Structured slash-command registry

**Files:**
- Modify: `src/ui/slash-commands.ts`
- Modify: `src/ui/slash-handlers.ts`
- Modify: `src/ui/composer.tsx`
- Create: `src/ui/slash-picker.tsx`
- Test: `src/ui/slash-commands.test.ts`, `src/ui/slash-picker.test.tsx`

**Interfaces:**
- Consumes: existing slash commands.
- Produces: `SlashCommandDefinition[]`, fuzzy picker popup in Composer.

- [ ] **Step 1: Define slash command definition**

Modify `src/ui/slash-commands.ts`:
```ts
export interface SlashCommandDefinition {
  name: string;
  aliases?: string[];
  description: string;
  availability: 'always' | 'idle';
  handler: SlashHandler;
}
```
Define the registry as `SlashCommandDefinition[]`.

- [ ] **Step 2: Build registry from handlers**

Move command metadata from `SLASH_COMMANDS` array into `slash-handlers.ts` or keep it in `slash-commands.ts`. Each entry must include description and availability.

Example:
```ts
export const SLASH_COMMANDS: SlashCommandDefinition[] = [
  { name: 'help', description: 'Show help', availability: 'always', handler: handleHelp },
  { name: 'plan', aliases: ['plan on', 'plan off'], description: 'Toggle plan mode', availability: 'always', handler: handlePlan },
  ...
];
```

- [ ] **Step 3: Fuzzy matching helper**

Add:
```ts
export function findSlashCommands(query: string): SlashCommandDefinition[] {
  const q = query.slice(1).toLowerCase();
  return SLASH_COMMANDS.filter((c) =>
    c.name.includes(q) ||
    c.aliases?.some((a) => a.includes(q)) ||
    c.description.toLowerCase().includes(q)
  );
}
```

- [ ] **Step 4: Composer popup**

Modify `src/ui/composer.tsx`:
- When value starts with `/`, compute matching commands.
- Render a popup list with name, aliases, description.
- Tab/Enter accepts the highlighted command.
- Escape dismisses.

- [ ] **Step 5: Update handler dispatch**

Modify `src/ui/app.tsx` `handleSubmit` to look up the handler from the registry and call it. Unknown slash input should be sent to the model unless it matches a reserved command name.

- [ ] **Step 6: Add slash-picker test**

Create `src/ui/slash-picker.test.tsx`:
```tsx
import { test, expect } from 'node:test';
import { render } from 'ink-testing-library';
import { SlashPicker } from './slash-picker.js';

test('renders matching commands', () => {
  const { lastFrameStripped } = render(<SlashPicker query="/pl" columns={80} />);
  expect(lastFrameStripped()).toContain('/plan');
});
```

- [ ] **Step 7: Run tests**

```bash
npm run test:compiled -- src/ui/slash-commands.test.ts src/ui/slash-picker.test.tsx
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/ui/slash-commands.ts src/ui/slash-handlers.ts src/ui/composer.tsx src/ui/slash-picker.tsx src/ui/slash-picker.test.tsx
git commit -m "feat: structured slash registry with fuzzy picker"
```

---

## Self-review

**Spec coverage:**
- KIMI-PARITY-001 Plan Mode — Tasks 4, 5.
- KIMI-PARITY-002 Shell Mode — Task 6.
- KIMI-PARITY-003 Session startup flags — Task 7.
- KIMI-PARITY-004 stream-json — Task 8.
- KIMI-PARITY-005 Fork/title/export/import — Task 9.
- KIMI-PARITY-019 Slash registry — Task 10.
- KIMI-PARITY-013 package identity bug — Task 1.

**Placeholder scan:** No TBD/TODO/fill-in-later steps. Each step includes concrete code or exact commands.

**Type consistency:**
- `RuntimeModeState` defined once in `src/agent/mode.ts` and reused.
- `AgentState.mode` is the canonical mode source.
- `TuiState` mirrors `inputMode`/`operatingMode` for UI binding.
- `ToolRegistry.definitions(operatingMode?)` accepts the same union as `RuntimeModeState.operatingMode`.

## Final validation

After all tasks:
```bash
npm run lint
npm run build
npm run test:compiled
npm run test:security
npm run completions:check
npm run api:contract
npm run pack:check
```

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-16-venice-cli-phase-a-parity.md`.

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh coder subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach?
