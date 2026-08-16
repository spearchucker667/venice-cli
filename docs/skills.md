# Skill System

## Overview

Skills are modular, progressive instructions that equip the Venice Agent with domain-specific knowledge and workflows.

## Skill Locations

- **Global Skills**: `~/.config/venice/skills/<skill-name>/`
- **Workspace Skills**: `.venice/skills/<skill-name>/`

## Skill Structure

```
my-skill/
├── SKILL.md
├── scripts/
└── references/
```

### `SKILL.md` Example

```markdown
---
name: github-release
description: Prepare, tag, and publish repository releases with changelogs.
tools:
  - shell
  - read_file
  - edit_file
---

# GitHub Release Workflow

1. Verify working tree is clean with `git_status`.
2. Run test suites with `npm test`.
3. Update version in `package.json`.
4. Generate release notes and commit.
```

## Progressive Loading

To conserve context tokens, full skill instructions are not loaded at startup. Only skill summaries (`name`, `description`) are exposed. When the agent selects a skill during task execution, it calls `skill_load` to inject the complete instructions.
