# Venice CLI Exhaustive Bug Hunt & Agent Handoff

## Mission

Perform a production-grade exhaustive audit and remediation pass for:

Repository: `https://github.com/spearchucker667/venice-cli`

Objective:

Transform Venice CLI from a basic Venice API terminal client into a
robust agentic developer CLI comparable in capability and reliability to
Kimi CLI, Gemini CLI, Codex CLI, Claude Code style tools, and other
modern coding agents.

This handoff is intentionally broad. Do not only fix reported bugs.
Perform a full repository inspection, identify hidden defects, missing
capabilities, architectural weaknesses, and incomplete implementations.

## Audit Requirements

Before modifying code:

1.  Clone or update the repository.
2.  Inspect every source file line-by-line.
3.  Review:
    -   package.json
    -   tsconfig
    -   build system
    -   CLI entrypoints
    -   command routing
    -   API clients
    -   streaming implementation
    -   session handling
    -   configuration system
    -   prompts/system instructions
    -   model selection
    -   error handling
    -   tests
    -   CI workflows
    -   release packaging
    -   npm publishing configuration

Do not assume existing functionality works because UI elements or
commands exist.

For every feature: - locate implementation - trace execution path - test
runtime behavior - verify failure handling - document findings

## Source of Truth

Venice API behavior must be verified against official sources:

-   Venice API documentation
-   Venice OpenAPI specification
-   Venice API examples

Validate:

-   chat completions
-   streaming/SSE behavior
-   tool calls
-   models endpoint
-   image capabilities
-   audio capabilities
-   search capabilities
-   character APIs
-   embeddings
-   future-compatible endpoints

Do not hardcode stale model lists when dynamic model discovery is
possible.

## Priority 0: Runtime Blockers

Investigate and fix:

### Streaming

Current reported issue: - streaming replies not returning LLM output

Audit:

-   SSE parser
-   fetch response handling
-   event decoding
-   partial token rendering
-   stream cancellation
-   timeout behavior
-   connection cleanup
-   error propagation

Required tests:

-   normal streaming response
-   empty stream
-   malformed SSE event
-   interrupted connection
-   API timeout
-   model error

## Priority 1: Missing Agent Architecture

The CLI should evolve beyond a chat wrapper.

Implement or plan:

## Agent Loop

Required:

-   observe
-   reason
-   plan
-   execute
-   verify
-   summarize

Capabilities:

-   multi-step tasks
-   tool execution
-   retry handling
-   state tracking
-   context management

## Tool System

Create a modular tool registry.

Example:

    tools/
      filesystem/
      shell/
      git/
      search/
      browser/
      mcp/
      memory/

Every tool requires:

-   schema
-   permission model
-   execution handler
-   error handling
-   tests

## Kimi CLI Feature Parity Review

Audit missing or incomplete equivalents.

## Slash Commands

Required commands:

    /config
    /settings
    /yolo
    /auto
    /plan
    /effort
    /compact
    /new
    /sessions
    /mcp
    /reload
    /plugins
    /theme
    /init

For each command:

-   verify parser registration
-   verify execution
-   verify help output
-   verify persistence behavior

## Configuration System

Implement:

    ~/.venice-cli/
        config.json
        sessions/
        prompts/
        themes/
        plugins/
        memory/

Support:

-   API key configuration
-   model defaults
-   system prompts
-   agent behavior
-   themes
-   MCP servers
-   plugin configuration

Never store secrets insecurely.

## Sessions

Required:

-   create session
-   list sessions
-   resume session
-   rename session
-   delete session
-   export session
-   compact context

Storage must survive restarts.

## Context Management

Implement:

-   automatic compaction
-   token estimation
-   history summarization
-   important-message retention
-   configurable limits

## Model Handling

Fix:

-   duplicate model selectors
-   inconsistent model state
-   stale model catalogs

Required:

-   one source of truth
-   dynamic `/models` loading
-   capability detection
-   model metadata
-   context limits
-   reasoning capability awareness

## Planning Mode

Implement:

    /plan

Expected behavior:

Before execution:

1.  analyze request
2.  generate plan
3.  request approval unless auto mode enabled
4.  execute steps
5.  verify results

## YOLO / Auto Modes

Implement clearly:

YOLO: - skip confirmation prompts - still show actions

AUTO: - autonomous execution loop - bounded retries - safety limits

## MCP Support

Implement:

-   MCP server discovery
-   configuration
-   lifecycle management
-   tool exposure
-   authentication handling

Example:

    ~/.venice-cli/mcp.json

## Plugin Architecture

Design:

    plugins/
      plugin-name/
        manifest.json
        commands/
        tools/

Support:

-   loading
-   validation
-   enable/disable
-   version checking

## Prompt System

Create:

    prompts/
      system/
      agents/
      models/

Features:

-   editable system prompts
-   model-specific prompts
-   prompt templates
-   reload without restart

## CLI UX Improvements

Audit:

-   terminal rendering
-   colors
-   animations
-   loading indicators
-   keyboard shortcuts
-   autocomplete
-   help output

Add:

-   polished startup screen
-   Venice branding
-   model information
-   connection status

## Error Handling

Replace generic errors.

Every failure should include:

-   what happened
-   likely cause
-   remediation
-   debug information

Example:

Bad:

    Error 400

Good:

    Venice API rejected request.

    Cause:
    Invalid model parameter.

    Fix:
    Run /models and select an available model.

## Testing Requirements

Add:

Unit tests:

-   commands
-   configuration
-   sessions
-   model registry
-   streaming parser

Integration tests:

-   mocked Venice API
-   streaming responses
-   tool execution
-   session recovery

Regression tests:

Every discovered bug gets a permanent test.

## CI/CD

Audit and repair:

-   GitHub Actions
-   Node versions
-   npm build
-   lint
-   typecheck
-   tests
-   package publishing

Required checks:

    npm ci
    npm run lint
    npm run typecheck
    npm test
    npm run build

## Packaging

Verify:

-   npm package contents
-   executable permissions
-   bin entry
-   versioning
-   README accuracy
-   publish workflow

Before publishing:

    npm pack --dry-run

## Final Deliverables

Return:

1.  Complete audit report.
2.  Severity-ranked findings:

```{=html}
<!-- -->
```
    P0 Critical
    P1 High
    P2 Medium
    P3 Low

3.  Fixed implementation.
4.  Added tests.
5.  Remaining limitations.
6.  Updated documentation.

Do not mark a feature complete unless:

-   code exists
-   command works
-   tests exist
-   failure states are handled

## Definition of Done

Venice CLI should provide:

-   reliable streaming
-   persistent sessions
-   agent execution loop
-   tool architecture
-   MCP support
-   plugin support
-   model awareness
-   planning mode
-   configuration management
-   polished CLI UX
-   production CI pipeline

The goal is not a simple API wrapper.

The goal is a full Venice-native agent CLI.
