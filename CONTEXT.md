# CONTEXT.md — Venice CLI domain glossary

Names used across this codebase to talk about seams and modules. Keep this
file current as the domain sharpens; architecture work should reuse these
terms rather than invent new ones.

## Agent runtime

- **Turn** — one round-trip cycle: build context → model call → parse tool
  calls → run tools → validate → persist. Foreground turns own the session,
  workspace, and context one at a time.
- **Tool** — a named, schema-validated capability the model can invoke
  (`AgentTool`). A tool is pure: `execute(input, context)` returns a
  `ToolResult`.
- **ToolEffect** — a declarative reaction a tool asks the runtime to apply
  (plan mode, skill activation, todo replacement, subagent report, user
  question). Tools *declare* effects; the runtime *interprets* them through a
  single interpreter (`src/agent/effects.ts`). The runtime never special-cases
  tool names.
- **Subagent** — a bounded, permission-scoped child runtime (read-only or
  write) that returns a structured `SubagentResult`.

## Agent state

- **Objective** — the user's high-level goal for a session.
- **Plan** — the plan-mode artifact (`PLAN.md`): a summary and ordered steps.
- **Todo list** — the working task list the model rewrites via `todo_write`.
- **Skill** — a loadable workflow (frontmatter + instructions) from
  `.venice/skills/` or `~/.config/venice/skills/`; activating a skill layers
  its body into context.
- **Changed files** — the root-aware mutation ledger of workspace edits.

## Safety

- **Workspace boundary** — the realpath + symlink-revalidation authority that
  confines filesystem mutations to approved roots.
- **Permission mode** — `suggest | auto-edit | auto | yolo`, the trust policy
  that gates tool execution.
- **Approval** — an explicit user grant for a tool or plan exit, distinct
  from a stored grant.

## External

- **Venice platform** — the upstream inference/media/search surface the CLI
  calls over HTTPS.
- **MCP server** — a Model Context Protocol stdio server whose tools are
  namespaced `mcp:<server>:<tool>`.
