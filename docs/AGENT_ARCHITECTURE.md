# Venice Agent Runtime — Comprehensive Architecture Specification

## 1. System Overview

Venice CLI provides a production-grade, workspace-aware AI coding agent runtime built around Venice AI's privacy-first model inference and API services.

The agent runtime is strictly decoupled from transport, UI, and external tool integrations. The system architecture enforces a clean separation of concerns across eleven modular subsystems:

```text
User / Terminal / Automation Script
               │
               ▼
┌─────────────────────────────────────────────────────────────┐
│                       CLI Entry Point                       │
│    (Interactive Ink TUI / Headless Noninteractive Runner)   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                        Agent Runtime                        │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │                      Iterative Loop                     │ │
│ └────────────┬─────────────────────────────┬──────────────┘ │
│              │                             │                │
│              ▼                             ▼                │
│    ┌──────────────────┐          ┌───────────────────┐      │
│    │ Context Manager  │          │   Tool Registry   │      │
│    │  (Tokens/Layers) │          │  (Schema & Exec)  │      │
│    └─────────┬────────┘          └─────────┬─────────┘      │
│              │                             │                │
│              ▼                             ▼                │
│    ┌──────────────────┐          ┌───────────────────┐      │
│    │   Model Client   │          │ Permission Engine │      │
│    │  (Venice Chat)   │          │  (4 Trust Modes)  │      │
│    └──────────────────┘          └─────────┬─────────┘      │
│                                            │                │
│   ┌────────────────────────────────────────┴────────────┐   │
│   │ Checkpoints │ Auto-Validation │ Workspace Boundary  │   │
│   └─────────────────────────────────────────────────────┘   │
└──────────────┬─────────────────────────────┬────────────────┘
               │                             │
               ▼                             ▼
┌──────────────────────────────┐ ┌────────────────────────────┐
│      Venice AI Platform      │ │     Local Environment      │
│  - Chat Completion Models    │ │  - Workspace Filesystem    │
│  - Web Search & Scrape       │ │  - Shell Process Execution │
│  - Image / Video / Audio     │ │  - Git VCS Inspection      │
│  - Privacy / E2EE / TEE      │ │  - Stdio MCP Server Hub    │
└──────────────────────────────┘ └────────────────────────────┘
```

---

## 2. Core Architectural Subsystems

### 2.1 Agent Runtime (`src/agent/runtime.ts`)
The `AgentRuntime` manages the complete agent turn lifecycle:
- Manages `AgentState` transition: `idle` → `thinking` → `executing_tool` → `verifying` → `complete` / `failed` / `cancelled`.
- Enforces turn limits (`maxTurns`, default: 25) and handles cancellation via `AbortSignal`.
- Coordinates model requests, tool calls, approval prompts, post-edit validations, and session serialization.
- Emits granular `AgentEvent`s over the `EventBus` to drive terminal rendering and session audit logs.

### 2.2 Agent State Model (`src/agent/types.ts`)
```typescript
interface AgentState {
  sessionId: string;
  workspaceRoot: string;
  model: string;
  objective: string;
  status: 'idle' | 'thinking' | 'awaiting_approval' | 'executing_tool' | 'verifying' | 'complete' | 'failed' | 'cancelled';
  messages: AgentMessage[];
  todos: TodoItem[];
  relevantFiles: string[];
  changedFiles: string[];
  toolHistory: ToolInvocation[];
  skillSummaries: SkillSummary[];
  activeSkills: string[];
  subagentReports: SubagentReport[];
  lastValidation?: ValidationResult;
  tokenUsage?: TokenUsage;
  contextSummary?: StructuredSummary;
}
```

### 2.3 Context Manager & Compaction (`src/agent/context.ts`)
The context manager structures the prompt into prioritized context layers:
1. **System Layer**: Built-in agent behavioral contract (strict verification, inspect before editing, never fabricate results).
2. **Project Instructions**: Loaded deterministically from `AGENTS.md`, `VENICE.md`, and `.venice/instructions.md`.
3. **Active Skills**: Injected markdown bodies of explicitly loaded skills.
4. **Working Memory**: Objective, active todos, known changed files, validation failures, subagent reports.
5. **Conversation Layer**: Multi-turn history with tool calls and results.

**Compaction Strategy**: When token utilization exceeds the threshold (75% of dynamic model context limit), the context manager compresses older conversation turns into a `StructuredSummary` while strictly preserving:
- Original objective and user constraints
- Unresolved validation and compiler failures
- List of modified and affected files
- Active todo items and completed decisions

### 2.4 Tool Registry & Schema Validation (`src/tools/registry.ts`)
Every tool implements the unified `AgentTool` interface:
```typescript
interface AgentTool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  risk: 'read' | 'write' | 'execute' | 'network' | 'destructive';
  execute(input: TInput, context: ToolContext): Promise<ToolResult<TOutput>>;
}
```
All inputs are verified against JSON Schema definitions using `ajv` before execution.

### 2.5 Workspace Safety Boundary (`src/agent/workspace.ts`)
- **Root Detection**: Automatically locates the repository Git root or falls back to `cwd`.
- **Path Traversal Protection**: Rejects `../` traversal, paths escaping the workspace root, and external absolute paths (`/etc/passwd`, `~/.ssh/`).
- **Symlink Escape Defense**: Resolves symlinks and ensures target realpaths remain within the workspace root.
- **Session-Scoped Mutation Tracking**: Tracks all genuinely mutated files across turns.

### 2.6 Permission Manager (`src/agent/permissions.ts`)
Four granular permission modes control tool execution:
- **`suggest`**: Requires explicit approval for writes, shell commands, network access, and external operations.
- **`auto-edit`**: Automatically permits workspace file edits; requires approval for shell execution and network calls.
- **`auto`**: Permits workspace edits and standard development commands (`npm test`, `git status`); prompts on high-risk operations.
- **`yolo`**: Permits autonomous execution within workspace boundaries while still blocking destructive host commands (`rm -rf /`).

### 2.7 Checkpoints & Undo Subsystem (`src/agent/checkpoints.ts`)
- Automatically takes pre-mutation file snapshots in `~/.venice/sessions/<uuid>/checkpoints/` before `write_file`, `edit_file`, or `apply_patch` executions.
- Supports atomic undo (`checkpoint_undo`) and redo (`checkpoint_redo`) operations across session turns.

### 2.8 Model Context Protocol (MCP) Hub (`src/mcp/`)
- Connects to external tool servers via standard stdio JSON-RPC 2.0.
- Normalizes discovered MCP tools into the `ToolRegistry` with the namespace `mcp:<server>:<tool>`.
- Configured via global `~/.venice/mcp.json` and workspace-scoped `.venice/mcp.json`.
- Implements fault isolation: failed servers emit events without crashing the agent runtime.

### 2.9 Progressive Skill System (`src/skills/`)
- Discovers skills from `~/.config/venice/skills/` and `.venice/skills/`.
- Parses frontmatter metadata to keep base system prompts token-efficient.
- Loads full instructions and specialized tool configurations on demand when `skill_load` is triggered.

### 2.10 Subagent Orchestration (`src/agent/subagents.ts`)
- **Read-Only Subagents**: Isolated exploration agents equipped with read/search/Git inspection tools and an independent context window.
- **Write Subagents**: Explicitly authorized agents with file write/edit tools (no shell, network, or nested subagent access). Outputs roll into parent session checkpoints and validation.

### 2.11 Venice AI Platform Integration (`src/tools/venice/`)
- Native access to Venice API capabilities: `web_search`, `web_scrape`, `generate_image`, `edit_image`, `upscale_image`, `remove_background`, `generate_video`, `image_to_video`, `transcribe_audio`, `text_to_speech`.
- Leverages Venice's zero-data-retention, E2EE, and TEE attestation infrastructure.
