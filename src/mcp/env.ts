/**
 * MCP child process environment construction.
 *
 * MCP servers are third-party executables that run with the privileges of the
 * current user. They must NOT silently inherit the full parent environment:
 * that would expose credentials such as VENICE_API_KEY, X_SIGN_IN_WITH_X,
 * GITHUB_TOKEN, AWS_*, SSH_AUTH_SOCK, and private CI variables.
 *
 * By default a server receives only a minimal allowlist of safe variables.
 * Explicit `env` entries in the MCP config may opt in to a parent value with
 * the `${env:VAR}` syntax:
 *
 *   {
 *     "mcpServers": {
 *       "repo-helper": {
 *         "command": "bash",
 *         "env": { "GITHUB_TOKEN": "${env:GITHUB_TOKEN}" }
 *       }
 *     }
 *   }
 *
 * Anything not declared this way is never visible to the child.
 */

const ENV_REFERENCE = /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Variables that are safe to propagate from the parent process because they
 * describe the execution environment rather than credentials.
 */
export const SAFE_MCP_ENV_KEYS = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'SystemRoot',
  'ComSpec',
  'PATHEXT',
] as const;

/**
 * Resolve `${env:VAR}` references inside a configured value against the
 * parent process environment. Unresolvable references are left untouched so
 * the config is not silently mangled.
 */
export function expandEnvReferences(value: string): string {
  return value.replace(ENV_REFERENCE, (match, name: string) => {
    const resolved = process.env[name];
    return resolved !== undefined ? resolved : match;
  });
}

/**
 * Build the environment handed to an MCP child process.
 *
 * - Copies only allowlisted safe variables from the parent.
 * - Applies explicit `configEnv` entries, expanding `${env:VAR}` references
 *   as an intentional opt-in to parent values.
 */
export function buildMcpEnv(configEnv: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const key of SAFE_MCP_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }

  for (const [key, value] of Object.entries(configEnv)) {
    env[key] = expandEnvReferences(value);
  }

  return env;
}
