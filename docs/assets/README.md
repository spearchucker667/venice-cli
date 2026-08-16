<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/venice-cli-brand-refresh/brand/logos/wordmark/venice-wordmark-on-midnight-blue.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/venice-cli-brand-refresh/brand/logos/wordmark/venice-wordmark-on-off-white.png">
    <img src="docs/assets/venice-cli-brand-refresh/brand/logos/wordmark/venice-wordmark-on-off-white.png" alt="Venice" width="760">
  </picture>
</p>

<h1 align="center">Venice CLI</h1>

<p align="center">
  <strong>Privacy-first AI agent and command-line toolkit powered by Venice</strong><br>
  <em>Private and uncensored AI.</em>
</p>

<p align="center">
  <a href="https://github.com/spearchucker667/venice-cli/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/spearchucker667/venice-cli/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://www.npmjs.com/package/@spearchucker667/venice-cli"><img alt="npm" src="https://img.shields.io/npm/v/%40spearchucker667%2Fvenice-cli.svg"></a>
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-0E2942.svg"></a>
</p>

Venice CLI gives you two interfaces to the Venice platform from one executable:

- a workspace-aware terminal agent that can inspect, edit, validate, search, use tools, connect to MCP servers, load skills, resume sessions, and run bounded subagents; and
- deterministic commands for chat, web search, parsing, image generation and editing, video, speech, music, embeddings, TEE/E2EE workflows, billing, API keys, RPC, and automation.

The bare `venice` command opens the interactive agent in the current workspace.

## Install

```bash
npm install -g @spearchucker667/venice-cli
```

Or run without installing globally:

```bash
npx @spearchucker667/venice-cli
```

Requirements:

- Node.js 18 or newer for the published CLI
- a Venice API key for authenticated operations

## Quick start

Get an API key from [Venice API settings](https://venice.ai/settings/api), then configure the CLI with a hidden prompt:

```bash
venice config set api_key
```

For non-interactive setup:

```bash
printf '%s' "$VENICE_API_KEY" | venice config set api_key --stdin
```

Or scope the key to the current process:

```bash
export VENICE_API_KEY='your-key-here'
```

Start the agent from a project:

```bash
cd /path/to/project
venice
```

Then work naturally:

```text
> explain this repository
> find the failing tests and fix the root cause
> review the current diff for security regressions
> search the latest Venice API documentation
> generate a README image and save it under docs/assets
```

Use `@file` to attach workspace context, `!command` to request an explicit shell command, and slash commands such as `/model`, `/status`, `/permissions`, `/sessions`, and `/help` to control the session.

## Interactive greeting

A new interactive session opens with a compact Venice identity panel. It is intentionally terminal-native: the README and other visual surfaces use the approved Venice artwork, while the CLI uses a lightweight ASCII interpretation for the terminal greeting.

```text
       \       /
        \  /\ /
         \ / /
          X
         / \
      __/   \__
     (__)   (__)

Venice CLI
Private and uncensored AI.

Model      kimi-k2-5
Mode       agent · auto-edit
Workspace  venice-cli · main

/help commands  /model switch  Ctrl+X shell
```

On an interactive TTY the logo performs a brief entrance animation and then becomes static. `VENICE_NO_ANIMATION=1`, `TERM=dumb`, CI/non-TTY output, and constrained terminal sizes fall back to a deterministic static or minimal greeting.

## Why Venice CLI

| Capability | What it gives you |
| --- | --- |
| Workspace agent | Repository-aware inspection, guarded edits, validation, Git context, checkpoints, resumable sessions, MCP, skills, and bounded subagents |
| Model control | Live model catalog, model switching, capability-aware behavior, reasoning controls, and structured output where supported |
| Privacy modes | TEE attestation and E2EE workflows on models that advertise those capabilities |
| Search and retrieval | AI-assisted web search, raw search, scraping, and document parsing |
| Media | Image generation/editing/upscaling, video, TTS, STT, music, sound effects, and media job handling |
| Automation | JSON output, non-interactive agent runs, shell completions, pipes, stdin, and machine-readable command modes |
| Platform tooling | Embeddings, characters, billing, API-key management, usage inspection, and crypto RPC |

## Agent controls

The bare command and explicit agent command start the same workspace agent:

```bash
venice
venice agent
```

Useful forms:

```bash
# One non-interactive task
venice agent --no-interactive \
  --prompt "Inspect this repository and fix the failing tests"

# Choose model, approval mode, workspace, and turn budget
venice agent \
  --model kimi-k2-5 \
  --approval auto-edit \
  --cwd ./my-project \
  --max-turns 40

# Machine-readable final state
venice agent --no-interactive --json \
  --prompt "Review the current diff"
```

The agent discovers the Git root and loads repository instructions from `AGENTS.md`, `VENICE.md`, and `.venice/instructions.md` when present.

Approval behavior is explicit:

| Mode | Automatically allowed |
| --- | --- |
| `suggest` | Nothing; tool execution requires approval |
| `auto-edit` | Workspace reads/writes, including write-capable bounded subagents; shell and network still require approval |
| `auto` | Reads, writes, and non-destructive local execution; network still requires approval |
| `yolo` | Non-destructive operations; destructive shell commands still require approval |

Write-capable subagents remain bounded to workspace read/edit operations. They do not receive shell or network tools.

Interactive controls include `/model`, `/models`, `/resume`, `/sessions`, `/status`, `/clear`, `/permissions`, `/help`, and `/quit`.

## Command map

| Command | Purpose |
| --- | --- |
| `venice` / `venice agent` | Interactive or non-interactive workspace agent |
| `venice chat` | Chat, multimodal input, tools, structured output, reasoning, E2EE/TEE options |
| `venice models` | Inspect and filter the live model catalog |
| `venice search` | Web search with synthesis or raw structured retrieval |
| `venice scrape` | Convert public web pages to Markdown/structured output |
| `venice parse` | Parse PDF, DOCX, PPTX, XLSX, and text documents |
| `venice image` | Image generation |
| `venice image-edit` | Single-image editing |
| `venice image-multi-edit` | Multi-image editing/compositing |
| `venice image-bg-remove` | Background removal |
| `venice upscale` | Image upscaling |
| `venice video` | Generate, quote, poll, retrieve, transcribe, upscale, and complete video jobs |
| `venice tts` / `venice voices` | Text-to-speech and voice catalog operations |
| `venice transcribe` | Speech-to-text |
| `venice voice clone` | Temporary voice cloning where supported |
| `venice music` | Music and sound-effect generation jobs |
| `venice embeddings` | Embeddings generation |
| `venice tee` | TEE attestation, verification, and response signatures |
| `venice characters` | Browse Venice character personas |
| `venice rpc` | Venice-proxied blockchain JSON-RPC |
| `venice billing` | Account balance, billed usage, and analytics |
| `venice keys` | API-key metadata, creation, rate limits, and deletion |
| `venice history` | Local conversation-history operations |
| `venice config` | Local configuration |
| `venice usage` | CLI-local usage statistics |
| `venice completions` | Bash, Zsh, and Fish completions |

Run `venice --help` or `venice <command> --help` for the complete current option surface.

## Chat

```bash
# Basic chat
venice chat "Explain quantum computing in simple terms"

# Choose a model
venice chat -m deepseek-v3.2 \
  "Solve this step by step: 15% of 340"

# Structured JSON
venice chat --json "extract the fields as JSON"
venice chat --json-schema schema.json "extract the fields"

# Reasoning control on models that advertise it
venice chat --reasoning-effort high "solve this"

# Attach local or remote multimodal inputs
venice chat --image photo.jpg "what is in this picture?"
venice chat --file report.pdf "summarize the findings"
venice chat --audio clip.wav "transcribe and answer"
venice chat --video https://example.com/clip.mp4 "describe this clip"

# Piped context
cat error.log | venice chat "find the root cause"
```

Capability-sensitive options fail closed: the selected model must advertise support for features such as structured output, reasoning controls, X search, TEE, or E2EE.

## Search, scraping, and documents

```bash
# Search with synthesis
venice search --citations "Latest developments in confidential AI"

# Raw structured search
venice search --raw --provider brave -f json \
  "Latest Venice API models"

# Scrape a public page to Markdown
venice scrape https://docs.venice.ai/llms.txt

# Parse a local document
venice parse report.pdf
venice parse report.pdf -o report.txt
venice parse report.pdf -f json
```

## Images

```bash
# Generate
venice image -o canal.png \
  "A cinematic Venetian canal at blue hour"

# Choose a model and ratio/resolution controls
venice image -m nano-banana-pro \
  -a 16:9 --resolution 2K --quality medium \
  "Canal at sunset"

# Edit
venice image-edit photo.jpg \
  "Remove the cars in the background" \
  -o edited.png

# Multi-edit
venice image-multi-edit base.jpg overlay.png \
  --prompt "Blend the overlay into the scene" \
  -o composited.png

# Remove a background
venice image-bg-remove product.jpg -o cutout.png

# Upscale
venice upscale photo.jpg -s 4 -o photo_4x.jpg
```

Image sizing and optional controls are model-specific. Use `venice image --help`, `venice image-styles`, and the live model catalog rather than assuming every image model exposes the same fields.

## Video

Video generation is asynchronous and queue-based:

```bash
# Quote before generation
venice video quote -m veo3-fast-text-to-video \
  -d 5s -a 16:9 "sunset over Venice"

# Generate
venice video generate -m veo3-fast-text-to-video \
  "Cinematic sunset over the lagoon"

# Image-to-video
venice video generate -m wan-2.6-image-to-video \
  -i photo.jpg "The scene comes alive"

# Poll and retrieve
venice video status -w <queue_id> -m <model>
venice video retrieve <queue_id> -m <model> -o result.mp4

# Inspect live video models
venice video models
```

## Audio, music, and transcription

```bash
# TTS
venice tts -v bf_emma -o greeting.mp3 \
  "Welcome to Venice"

# Live voice catalog
venice voices

# STT
venice transcribe -t recording.mp3

# Music model catalog and quote
venice music models
venice music quote -m elevenlabs-music -d 60

# Queue instrumental music
venice music generate -m elevenlabs-music \
  -d 60 --instrumental \
  "Atmospheric electronic score"
```

## Models and secure execution

```bash
# Browse models
venice models
venice models -t image
venice models --privacy
venice models --tee
venice models --e2ee
venice models -s llama

# Fetch a TEE attestation report
venice tee attestation <tee-model>

# Verify attestation policy
venice tee verify <tee-model>

# Chat with an E2EE-capable model
venice chat -m <e2ee-capable-model> \
  "Your private message"
```

E2EE is capability-driven. When enabled, the CLI verifies the relevant secure-execution properties and applies the restrictions required to preserve the encrypted path. Local history and plaintext sessions are separate from those guarantees.

See [Security](docs/security.md) and [Agent Runtime Architecture](docs/architecture/agent-runtime.md) for implementation boundaries.

## Configuration

```bash
venice config init
venice config show
venice config set api_key
venice config set default_model kimi-k2-5
venice config get default_model
venice config unset default_model
venice config path
```

Supported configuration includes the API key, default chat/image models, default voice, output format, color preference, and usage display.

On POSIX systems, the CLI restricts its configuration directory and file permissions. Windows relies on the user profile's ACLs rather than POSIX mode bits.

### Environment variables

| Variable | Purpose |
| --- | --- |
| `VENICE_API_KEY` | API key; overrides the stored configuration value |
| `NO_COLOR` | Disable colored terminal output |
| `VENICE_NO_ANIMATION=1` | Disable the interactive Venice greeting animation and render its stable frame immediately |

## Sessions and local history

Agent session state and checkpoints are stored under `~/.venice/sessions/` and are scoped to the current workspace for resume/list operations.

The chat `--continue` path uses local history under `~/.venice/history.json`. Attachment bytes and source URLs are not persisted in that history; secure E2EE/TEE transcripts are kept separate from plaintext continuation behavior.

```bash
venice history list
venice history show
venice history export history.json
venice history clear
```

See [Sessions](docs/sessions.md) for lifecycle details.

## MCP and skills

Global MCP configuration:

```bash
venice mcp add
venice mcp list
venice mcp inspect <name>
venice mcp enable <name>
venice mcp disable <name>
venice mcp remove <name>
```

Workspace MCP configuration is merged from `.venice/mcp.json`. Do not commit credentials there.

Skills are discovered from:

```text
~/.config/venice/skills/<name>/SKILL.md
.venice/skills/<name>/SKILL.md
```

Inspect them with:

```bash
venice skills list
venice skills show <name>
```

See [MCP](docs/mcp.md) and [Skills](docs/skills.md).

## Billing, keys, and RPC

```bash
# Billing
venice billing balance
venice billing usage --days 7
venice billing analytics --lookback 30d

# API keys
venice keys list
venice keys create --name ci --usd-limit 25 \
  --limit-period month --output ./ci.key
venice keys rate-limits
venice keys delete <key-id>

# RPC
venice rpc networks
venice rpc ethereum-mainnet eth_blockNumber
venice rpc base-mainnet eth_getBalance 0xYourAddress latest
```

API-key creation is designed not to print the newly returned secret to normal output; use the required output file and protect it like any other credential.

## Output formats and shell use

| Format | Intended use |
| --- | --- |
| `pretty` | Human-readable interactive output |
| `json` | Machine-readable automation |
| `markdown` | Documentation-oriented output |
| `raw` | Pipes and undecorated text |

When appropriate, the CLI detects piped output and uses an undecorated form.

```bash
venice chat -f json "List three colors" | jq '.'
venice chat "Generate code" | pbcopy
```

Shell completions:

```bash
# Bash
venice completions bash >> ~/.bashrc

# Zsh
venice completions zsh >> ~/.zshrc

# Fish
venice completions fish > ~/.config/fish/completions/venice.fish
```

## Development

Clone this fork and install dependencies:

```bash
git clone https://github.com/spearchucker667/venice-cli.git
cd venice-cli
npm install
```

Core development commands:

```bash
npm run build
npm run lint
npm test
npm run test:security
npm run verify
```

Run the development entry point:

```bash
npm run dev -- agent
npm run dev -- chat "Hello"
```

The published package declares Node.js 18+ support. The repository's current ESLint 10 development toolchain requires a newer Node 20 release, so contributors should use a current supported Node 20+ environment for development and CI parity.

## Documentation

- [Agent Runtime Architecture](docs/architecture/agent-runtime.md)
- [Configuration](docs/configuration.md)
- [Permissions](docs/permissions.md)
- [Sessions](docs/sessions.md)
- [MCP](docs/mcp.md)
- [Skills](docs/skills.md)
- [Security](docs/security.md)
- [Development](docs/development.md)
- [Contributing](CONTRIBUTING.md)

## Brand assets

This README uses the supplied official Venice artwork rather than a recreated logo. The terminal greeting's ASCII mark is a terminal-only decorative interpretation and must not replace the approved visual logo in README, website, package, social, or other brand surfaces.

Brand source files for this refresh live under:

```text
docs/assets/venice-cli-brand-refresh/brand/
```

Primary palette from the supplied Venice brand system:

| Token | Hex | Use |
| --- | --- | --- |
| Deep Blue | `#0E2942` | Primary dark text/logo on light surfaces |
| Midnight Blue | `#0A121A` | Dark-mode foundation |
| Off White | `#F7F5ED` | Light foundation / logo on dark surfaces |
| Venetian Blue | `#3C8FDD` light / `#125DA3` dark | Accent only; not a logo color |

Do not stretch, redraw, recolor, outline, fade, add effects to, or crowd the approved Venice wordmark, keys, or lockup.

Code in this repository is licensed under MIT. Brand names, marks, and supplied brand artwork should not be assumed to be relicensed merely because they are stored beside MIT-licensed code; follow the applicable Venice brand/trademark guidance when redistributing or reusing them.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change. For agent/TUI work, preserve permission boundaries, non-interactive behavior, deterministic tests, terminal-width compatibility, and existing security semantics.

## License

MIT. See [LICENSE](LICENSE).

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/venice-cli-brand-refresh/brand/logos/keys/venice-keys-on-midnight-blue.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/venice-cli-brand-refresh/brand/logos/keys/venice-keys-on-off-white.png">
    <img src="docs/assets/venice-cli-brand-refresh/brand/logos/keys/venice-keys-on-off-white.png" alt="Venice crossed keys" width="72">
  </picture>
</p>
