/**
 * Export a session as Markdown, round-trippable JSON, or a debug zip archive.
 */

import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SessionManager, SESSION_SCHEMA_VERSION, type StoredSession } from '../agent/sessions.js';
import { detectWorkspaceRoot } from '../agent/runtime.js';
import { formatFileRef } from '../agent/workspace.js';
import { createZip } from '../lib/zip.js';
import { formatError } from '../lib/output.js';
import type { AgentState } from '../agent/types.js';
import type { AgentEvent } from '../agent/events.js';

function formatSessionAsMarkdown(state: AgentState, events?: AgentEvent[]): string {
  const lines: string[] = [];
  lines.push(`# Session ${state.sessionId}`);
  if (state.title) lines.push(`## ${state.title}`);
  if (state.parentSessionId) lines.push(`Parent: ${state.parentSessionId}`);
  lines.push(`Model: ${state.model}`);
  lines.push(`Workspace: ${state.workspaceRoot}`);
  lines.push(`Objective: ${state.objective || '(none)'}`);
  lines.push('');
  lines.push('## Messages');
  for (const message of state.messages) {
    if (typeof message.content !== 'string') continue;
    lines.push(`### ${message.role}`);
    lines.push(message.content);
    lines.push('');
  }
  if (state.changedFiles.length) {
    lines.push('## Changed Files');
    for (const file of state.changedFiles) {
      lines.push(`- ${formatFileRef(file, state.workspace.primaryRoot)}`);
    }
    lines.push('');
  }
  if (events?.length) {
    lines.push('## Events');
    for (const event of events) lines.push(`- ${event.type}`);
    lines.push('');
  }
  return lines.join('\n');
}

function buildPortablePayload(stored: { state: AgentState; events: AgentEvent[] }): StoredSession {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: stored.state.sessionId,
    state: stored.state,
    title: stored.state.title,
    parentSessionId: stored.state.parentSessionId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    events: stored.events,
  };
}

function buildDebugZip(stored: { state: AgentState; events: AgentEvent[] }): Buffer {
  const payload = buildPortablePayload(stored);
  const manifest = {
    tool: 'venice-cli',
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: stored.state.sessionId,
    exportedAt: new Date().toISOString(),
    entries: ['session.json', 'messages.jsonl', 'events.jsonl', 'manifest.json'],
  };
  return createZip([
    { name: 'session.json', data: Buffer.from(JSON.stringify(payload, null, 2)) },
    { name: 'messages.jsonl', data: Buffer.from(stored.state.messages.map((m) => JSON.stringify(m)).join('\n') + '\n') },
    { name: 'events.jsonl', data: Buffer.from(stored.events.map((e) => JSON.stringify(e)).join('\n') + '\n') },
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) },
  ]);
}

export function registerExportCommand(program: Command): void {
  program
    .command('export [sessionId]')
    .description('Export a session as Markdown, round-trippable JSON, or a debug zip')
    .option('--format <format>', 'Output format (markdown|json|debug-zip)', 'markdown')
    .option('--debug', 'Export a debug zip archive (alias for --format debug-zip)')
    .option('--workspace <workspace>', 'Workspace root to filter sessions')
    .option('-o, --output <output>', 'Output file path')
    .action(async (sessionId, options) => {
      // Resolve the workspace the same way agent startup does (git root from
      // the current directory) so `export` and the agent agree on session
      // identity (VC-KIMI-060).
      const workspaceRoot = options.workspace
        ? String(options.workspace)
        : detectWorkspaceRoot(process.cwd());
      const manager = new SessionManager();

      let targetId = sessionId;
      if (!targetId) {
        const sessions = manager.list(workspaceRoot);
        if (!sessions.length) {
          console.error(formatError('No saved session to export'));
          process.exit(2);
        }
        targetId = sessions[0]!.sessionId;
      }

      const stored = manager.load(targetId, workspaceRoot);
      if (!stored) {
        console.error(formatError(`Session not found: ${targetId}`));
        process.exit(2);
      }

      const format = options.debug ? 'debug-zip' : String(options.format || 'markdown');
      if (format !== 'markdown' && format !== 'json' && format !== 'debug-zip') {
        console.error(formatError(`Invalid format: ${format} (expected markdown|json|debug-zip)`));
        process.exit(2);
      }

      const extension = format === 'json' ? 'json' : format === 'debug-zip' ? 'zip' : 'md';
      const output = options.output || path.join(workspaceRoot, `${stored.state.sessionId}.${extension}`);
      if (format === 'json') {
        fs.writeFileSync(output, JSON.stringify(buildPortablePayload(stored), null, 2));
      } else if (format === 'debug-zip') {
        fs.writeFileSync(output, buildDebugZip(stored));
      } else {
        fs.writeFileSync(output, formatSessionAsMarkdown(stored.state, stored.events));
      }
      console.log(`Exported session ${stored.state.sessionId} to ${output} (${format})`);
    });
}
