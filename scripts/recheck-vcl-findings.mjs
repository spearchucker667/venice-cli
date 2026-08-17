#!/usr/bin/env node
/**
 * Re-check the Venice CLI audit findings (VCL-001..062) against the current
 * working tree by running each finding's `rg` locator.
 *
 * This is a *locator* check, not a semantic re-verification: it reports whether
 * the code pattern named in each finding's evidence anchor is still present.
 * Interpretation depends on `kind`:
 *
 *   - `bug`    : the anchor is a defect. A MATCH means the buggy pattern is
 *                likely still present (re-verify); NO MATCH means it may have
 *                been fixed (confirm the fix + test).
 *   - `parity` : the anchor is a missing feature. A MATCH means the feature
 *                now exists (likely fixed); NO MATCH means it is still absent.
 *   - `env`    : environmental (CI). Always re-verify manually.
 *
 * Exit code 0 on success, 1 if any `rg` invocation errors unexpectedly.
 *
 * Usage: node scripts/recheck-vcl-findings.mjs [--json]
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

/** @typedef {{ id: string; kind: 'bug' | 'parity' | 'env'; status: 'fixed' | 'partial' | 'present'; pattern: string; paths: string[] }} Finding */

/** @type {Finding[]} */
const FINDINGS = [
  // ---- P0 ----
  { id: 'VCL-001', kind: 'bug', status: 'partial', pattern: 'activeTurnSignal|updateSignal|abortControllerRef', paths: ['src/ui/app.tsx', 'src/agent/runtime.ts'] },
  { id: 'VCL-057', kind: 'bug', status: 'fixed', pattern: 'does not auto-approve raw shell commands regardless of classification', paths: ['src/agent/permissions.test.ts'] },
  { id: 'VCL-062', kind: 'env', status: 'present', pattern: 'verify', paths: ['package.json'] },

  // ---- P1 ----
  { id: 'VCL-002', kind: 'bug', status: 'partial', pattern: 'chatCompletionStream|abortSignal|signal', paths: ['src/lib/api.ts'] },
  { id: 'VCL-003', kind: 'bug', status: 'partial', pattern: 'isRunning|slash|name: "(new|clear|resume|fork|model|plan|permissions|reload|import|delete|theme|skill|compact)"', paths: ['src/ui/slash-commands.ts', 'src/ui/slash-handlers.ts', 'src/ui/app.tsx'] },
  { id: 'VCL-004', kind: 'bug', status: 'partial', pattern: 'executeDirectTool|turnInProgress', paths: ['src/agent/runtime.ts'] },
  { id: 'VCL-005', kind: 'bug', status: 'fixed', pattern: 'carries a queued @file attachment across the queue boundary', paths: ['src/agent/runtime.test.ts'] },
  { id: 'VCL-006', kind: 'bug', status: 'fixed', pattern: 'does not leak a prior turn attachment into an attachment-less queued turn', paths: ['src/agent/runtime.test.ts'] },
  { id: 'VCL-007', kind: 'bug', status: 'fixed', pattern: 'compaction preserves the active turn file context', paths: ['src/agent/context.test.ts'] },
  { id: 'VCL-008', kind: 'bug', status: 'fixed', pattern: 're-applies the restored model profile context budget on resume', paths: ['src/agent/runtime.test.ts'] },
  { id: 'VCL-009', kind: 'bug', status: 'fixed', pattern: 'refreshModelProfile|chat-only|UNKNOWN_CONTEXT_LIMIT', paths: ['src/agent/runtime.ts'] },
  { id: 'VCL-010', kind: 'bug', status: 'fixed', pattern: 'limit_reached', paths: ['src/agent/types.ts'] },
  { id: 'VCL-011', kind: 'bug', status: 'fixed', pattern: 'addConversation|assistant', paths: ['src/commands/chat.ts'] },
  { id: 'VCL-012', kind: 'bug', status: 'fixed', pattern: 'applies explicit CLI overrides over persisted state on resume', paths: ['src/agent/runtime.test.ts'] },
  { id: 'VCL-013', kind: 'bug', status: 'fixed', pattern: 'machine output formats stay headless', paths: ['src/commands/agent.test.ts'] },
  { id: 'VCL-017', kind: 'bug', status: 'fixed', pattern: 'scoped rule must be injected for the matching path', paths: ['src/agent/runtime.test.ts'] },
  { id: 'VCL-037', kind: 'bug', status: 'fixed', pattern: 'expectedWorkspace|workspace-scoped session deletion|cross-workspace', paths: ['src/agent/sessions.ts', 'src/agent/sessions.test.ts'] },
  { id: 'VCL-040', kind: 'bug', status: 'fixed', pattern: "clearPlan refuses to delete a plan path outside the workspace", paths: ['src/agent/plan-mode.test.ts'] },
  { id: 'VCL-041', kind: 'bug', status: 'partial', pattern: 'path\\.resolve\\(root, relativePath\\)|writeFileSync', paths: ['src/agent/checkpoints.ts'] },
  { id: 'VCL-042', kind: 'bug', status: 'partial', pattern: 'loadConfig|JSON\\.parse|return \\{\\}', paths: ['src/lib/config.ts'] },
  { id: 'VCL-045', kind: 'bug', status: 'partial', pattern: 'mcpServers|transport|command|url', paths: ['src/mcp/config.ts'] },
  { id: 'VCL-049', kind: 'bug', status: 'partial', pattern: '\\[DONE\\]|done: true|finish_reason', paths: ['src/lib/api.ts'] },
  { id: 'VCL-056', kind: 'bug', status: 'present', pattern: 'comma|argCount|opStack', paths: ['src/lib/tools.ts'] },
  { id: 'VCL-058', kind: 'bug', status: 'present', pattern: 'signal|AbortSignal|spawn|kill', paths: ['src/tools/shell/execute.ts'] },

  // ---- P2 ----
  { id: 'VCL-014', kind: 'bug', status: 'present', pattern: 'stdin|max.*stdin|process\\.stdin', paths: ['src/commands/agent.ts', 'src/commands/chat.ts'] },
  { id: 'VCL-015', kind: 'bug', status: 'present', pattern: 'auto|yolo|approval|permission', paths: ['src/commands/agent.ts'] },
  { id: 'VCL-016', kind: 'bug', status: 'present', pattern: 'BUILT_IN_AGENT_CONTRACT|system.*contract|default.*system', paths: ['src/agent/context.ts', 'src/agent/instructions.ts'] },
  { id: 'VCL-018', kind: 'bug', status: 'present', pattern: 'name: "reload"|discoverSkills', paths: ['src/ui/slash-commands.ts', 'src/ui/slash-handlers.ts'] },
  { id: 'VCL-019', kind: 'bug', status: 'present', pattern: "name: 'config'|configuration hub", paths: ['src/ui/slash-commands.ts', 'src/ui/slash-handlers.ts'] },
  { id: 'VCL-020', kind: 'bug', status: 'present', pattern: "name: 'plugins'|Manage plugins", paths: ['src'] },
  { id: 'VCL-021', kind: 'bug', status: 'present', pattern: 'name: "mcp"|restart|enable|disable', paths: ['src/ui/slash-handlers.ts', 'src/mcp'] },
  { id: 'VCL-022', kind: 'bug', status: 'present', pattern: 'name: "skill"|skillName|/skill', paths: ['src/ui/slash-commands.ts', 'src/ui/slash-handlers.ts', 'src/skills/registry.ts'] },
  { id: 'VCL-023', kind: 'bug', status: 'present', pattern: 'global|project|extra|Map|set\\(', paths: ['src/skills/registry.ts'] },
  { id: 'VCL-024', kind: 'parity', status: 'present', pattern: 'SKILL\\.md|readdir', paths: ['src/skills/registry.ts'] },
  { id: 'VCL-025', kind: 'bug', status: 'present', pattern: '\\.config/venice/skills|\\.venice/skills|skillsDir', paths: ['src/skills/registry.ts', 'src/ui/slash-handlers.ts', 'AGENTS.md'] },
  { id: 'VCL-026', kind: 'parity', status: 'present', pattern: 'afk', paths: ['src', 'package.json', 'README.md'] },
  { id: 'VCL-027', kind: 'parity', status: 'present', pattern: 'btw|side.?question|side.?query', paths: ['src'] },
  { id: 'VCL-028', kind: 'parity', status: 'present', pattern: 'background.?task|/task|task list|task cancel', paths: ['src'] },
  { id: 'VCL-029', kind: 'parity', status: 'present', pattern: 'add-dir|additionalWorkspace', paths: ['src'] },
  { id: 'VCL-030', kind: 'parity', status: 'present', pattern: 'thinking|reasoningEffort', paths: ['src'] },
  { id: 'VCL-031', kind: 'parity', status: 'present', pattern: 'print|quiet|acp|wire|stream-json', paths: ['src/commands', 'src/agent'] },
  { id: 'VCL-032', kind: 'parity', status: 'present', pattern: 'max.*steps|max.*retries|ralph|maxTurns', paths: ['src'] },
  { id: 'VCL-033', kind: 'parity', status: 'present', pattern: 'plugin\\.json|plugin install|PluginManager', paths: ['src'] },
  { id: 'VCL-034', kind: 'parity', status: 'present', pattern: 'undo|checkpoint|fork|restore', paths: ['src/agent', 'src/ui'] },
  { id: 'VCL-035', kind: 'parity', status: 'present', pattern: 'session|resume|continue', paths: ['src/commands/agent.ts', 'src/agent/sessions.ts'] },
  { id: 'VCL-036', kind: 'parity', status: 'present', pattern: 'planMode|operatingMode|read.?only', paths: ['src/agent', 'src/ui', 'src/tools'] },
  { id: 'VCL-038', kind: 'bug', status: 'present', pattern: 'events\\.jsonl|session\\.json|assistant_delta', paths: ['src/agent/sessions.ts', 'src/agent/events.ts'] },
  { id: 'VCL-039', kind: 'bug', status: 'present', pattern: 'schema|version|JSON\\.parse|migrat', paths: ['src/agent/sessions.ts', 'src/agent/runtime.ts'] },
  { id: 'VCL-043', kind: 'bug', status: 'present', pattern: 'history|usage|writeFileSync|rename|fsync', paths: ['src/lib', 'src/commands'] },
  { id: 'VCL-044', kind: 'bug', status: 'present', pattern: 'history|usage|JSON\\.parse|catch', paths: ['src/lib'] },
  { id: 'VCL-046', kind: 'bug', status: 'present', pattern: 'list_changed|refreshServerTools|set\\(', paths: ['src/mcp/manager.ts', 'src/mcp/client.ts'] },
  { id: 'VCL-047', kind: 'bug', status: 'present', pattern: 'exit|close|error|connected|isRunning', paths: ['src/mcp/client.ts', 'src/mcp/manager.ts'] },
  { id: 'VCL-048', kind: 'bug', status: 'present', pattern: 'isRunning|invoke.*mcp|callTool', paths: ['src/agent/runtime.ts', 'src/mcp'] },
  { id: 'VCL-050', kind: 'bug', status: 'present', pattern: 'data:|split|event:', paths: ['src/lib/api.ts'] },
  { id: 'VCL-051', kind: 'bug', status: 'present', pattern: 'IDLE_TIMEOUT|idle.*timeout|30000|30_000', paths: ['src/lib/api.ts'] },
  { id: 'VCL-052', kind: 'bug', status: 'present', pattern: 'turnId|eventId|model_request', paths: ['src/ui/renderer.ts', 'src/agent/events.ts', 'src/agent/runtime.ts'] },
  { id: 'VCL-053', kind: 'bug', status: 'present', pattern: 'version|final|terminal|error|complete', paths: ['src/agent/stream-json.ts', 'src/ui/renderer.ts', 'src/agent/events.ts'] },
  { id: 'VCL-054', kind: 'bug', status: 'present', pattern: 'toolCallId|tool_start|tool_complete|tool_result', paths: ['src/agent/events.ts', 'src/agent/runtime.ts', 'src/ui/renderer.ts'] },
  { id: 'VCL-055', kind: 'bug', status: 'present', pattern: 'transcript|delta|find\\(|assistant_delta', paths: ['src/ui/app.tsx', 'src/ui/transcript.tsx'] },
  { id: 'VCL-059', kind: 'bug', status: 'present', pattern: 'timeoutMs|timeout|Number|parse', paths: ['src/tools/shell', 'src/lib/tools.ts'] },
  { id: 'VCL-060', kind: 'bug', status: 'present', pattern: 'parallel-tool-calls|parallelToolCalls', paths: ['src/commands/chat.ts'] },
  { id: 'VCL-061', kind: 'bug', status: 'present', pattern: 'github|sha|commit|openapi|drift|api:contract', paths: ['scripts/api-drift-check.mjs', 'package.json'] },

];

const json = process.argv.includes('--json');

/** @param {string} pattern @param {string[]} paths */
function runLocator(pattern, paths) {
  const existing = paths.filter((p) => existsSync(new URL(`../${p}`, import.meta.url)));
  if (existing.length === 0) return { matches: 0, first: '', missing: true };
  try {
    const out = execFileSync('rg', ['--no-heading', '-n', pattern, ...existing], {
      encoding: 'utf-8',
      maxBuffer: 8 * 1024 * 1024,
    });
    const lines = out.split('\n').filter((l) => l.trim());
    return { matches: lines.length, first: lines[0] || '', missing: false };
  } catch (err) {
    // rg exits 1 when there are no matches; 2 is a real error.
    if (err.status === 1) return { matches: 0, first: '', missing: false };
    return { matches: -1, first: String(err.message).split('\n')[0], missing: false };
  }
}

const rows = FINDINGS.map((f) => {
  const r = runLocator(f.pattern, f.paths);
  // For 'bug' kind, NO MATCH suggests the anchor is gone (fixed/refactored);
  // for 'parity' kind, NO MATCH means the feature is still absent (present).
  const signal =
    f.status === 'fixed'
      ? r.matches > 0
        ? 'fix-test present'
        : 'SUSPECT REGRESSION'
      : f.kind === 'parity'
        ? r.matches > 0
          ? 'feature present (re-verify)'
          : 'still absent'
        : r.matches > 0
          ? 'anchor present (re-verify)'
          : 'anchor gone (re-verify)';
  return { ...f, matches: r.matches, first: r.first, signal };
});

const byStatus = { fixed: 0, partial: 0, present: 0 };
for (const r of rows) byStatus[r.status]++;

if (json) {
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), counts: byStatus, findings: rows }, null, 2));
} else {
  const idW = Math.max(...rows.map((r) => r.id.length));
  for (const r of rows) {
    const line = `${r.id.padEnd(idW)}  ${r.status.padEnd(7)}  ${r.kind.padEnd(6)}  M:${String(r.matches).padStart(3)}  ${r.signal}`;
    console.log(line);
  }
  console.log('\n---');
  console.log(`counts: ${JSON.stringify(byStatus)}`);
  console.log('note: locator check only; semantic re-verification requires running the cited test.');
}

process.exitCode = rows.some((r) => r.matches === -1) ? 1 : 0;
