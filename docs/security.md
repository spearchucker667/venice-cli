# Security Architecture

## Workspace Boundary and Sandboxing

The agent's default trust domain is strictly the canonical repository root:

- **Path Canonicalization**: All input paths are resolved with realpath resolution.
- **Traversal Prevention**: Relative escapes (`../`) and symlinks pointing outside the workspace boundary are rejected.
- **Absolute Paths**: Direct absolute paths outside workspace roots require explicit user approval.

## Secret and Credential Handling

- **Environment Protection**: Raw environment blocks and sensitive `.env` files are guarded against uncontrolled model context dumping.
- **Transcript Sanitization**: Sensitive authorization tokens and API keys are redacted before persistence in session files.
- **No Telemetry**: No hidden analytics, remote telemetry, or external tracking exist within the agent runtime.

## Subagent Isolation

- **Read-Only Default**: Subagents default to read-only tool sets without file mutation or shell access.
- **Write-Mode Constraints**: Write-capable subagents receive only workspace read/edit tools and run without shell, network, or nested-subagent capabilities under parent checkpoint tracking.
