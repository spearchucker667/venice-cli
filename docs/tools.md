# Tool Reference

## Overview

All capabilities available to the Venice Agent runtime are implemented as `AgentTool` definitions registered in the central `ToolRegistry`.

## Built-In Tools

### Filesystem

| Tool | Risk | Description |
|---|---|---|
| `read_file` | `read` | Read the content of a single file within the workspace. |
| `read_many_files` | `read` | Read multiple files in a single turn. |
| `write_file` | `write` | Create or overwrite a file with full content. |
| `edit_file` | `write` | Replace a target block of text with replacement content. |
| `apply_patch` | `write` | Apply unified diff patches to workspace files. |
| `list_directory` | `read` | List child directories and files within a path. |
| `glob` | `read` | Find files matching glob patterns (e.g. `src/**/*.ts`). |

### Search & Discovery

| Tool | Risk | Description |
|---|---|---|
| `grep` | `read` | Search file contents using regex or exact literal patterns. |
| `find` | `read` | Locate files by name or pattern. |

### Shell & Git

| Tool | Risk | Description |
|---|---|---|
| `shell` | `execute` | Execute shell commands inside the workspace root. |
| `run_validation` | `execute` | Run detected project test, lint, or build commands. |
| `git_status` | `read` | Query the current Git branch and working tree status. |
| `git_diff` | `read` | View working tree differences or staged changes. |
| `git_log` | `read` | Inspect recent Git commit history. |

### Agent Planning & Meta

| Tool | Risk | Description |
|---|---|---|
| `todo_read` | `read` | Retrieve active todos and plan items. |
| `todo_write` | `write` | Update or replace the active todo list. |
| `ask_user` | `read` | Ask the user a clarifying question. |
| `checkpoint_list` | `read` | List local file checkpoints. |
| `checkpoint_undo` | `write` | Revert to a previous file checkpoint. |
| `checkpoint_redo` | `write` | Reapply an undone checkpoint. |
| `skill_list` | `read` | List available project and global skills. |
| `skill_load` | `read` | Load detailed instructions for a specific skill. |
| `spawn_agent` | `read`/`write` | Spawn an isolated subagent for bounded tasks. |

### Venice Media & Search

| Tool | Risk | Description |
|---|---|---|
| `web_search` | `network` | Perform live web search with AI synthesis. |
| `web_scrape` | `network` | Scrape public web pages to Markdown. |
| `generate_image` | `network` | Generate images using Venice image models. |
| `edit_image` | `network` | Edit existing images using prompt instructions. |
| `upscale_image` | `network` | Upscale image resolution. |
| `remove_background` | `network` | Remove background from images. |
| `generate_video` | `network` | Generate AI video clips. |
| `image_to_video` | `network` | Animate reference images into video. |
| `text_to_speech` | `network` | Convert text into speech audio. |
| `transcribe_audio` | `network` | Transcribe speech audio to text. |
