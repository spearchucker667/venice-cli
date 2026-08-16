/**
 * Export a session as Markdown or debug archive.
 */

import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SessionManager, type StoredSession } from '../agent/sessions.js';
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
    for (const file of state.changedFiles) lines.push(`- ${file}`);
    lines.push('');
  }
  if (events?.length) {
    lines.push('## Events');
    for (const event of events) lines.push(`- ${event.type}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function registerExportCommand(program: Command): void {
  program
    .command('export [sessionId]')
    .description('Export a session as Markdown or round-trippable JSON')
    .option('--format <format>', 'Output format (markdown|json)', 'markdown')
    .option('--debug', 'Export a debug archive (alias for --format json)')
    .option('--workspace <workspace>', 'Workspace root to filter sessions')
    .option('-o, --output <output>', 'Output file path')
    .action(async (sessionId, options) => {
      const workspaceRoot = options.workspace ? String(options.workspace) : process.cwd();
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

      const format = options.debug ? 'json' : String(options.format || 'markdown');
      if (format !== 'markdown' && format !== 'json') {
        console.error(formatError(`Invalid format: ${format} (expected markdown|json)`));
        process.exit(2);
      }

      const extension = format === 'json' ? 'json' : 'md';
      const output = options.output || path.join(workspaceRoot, `${stored.state.sessionId}.${extension}`);
      if (format === 'json') {
        // Portable, round-trip compatible export: `venice import` can load it.
        const payload: StoredSession = {
          schemaVersion: 2,
          sessionId: stored.state.sessionId,
          state: stored.state,
          title: stored.state.title,
          parentSessionId: stored.state.parentSessionId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          events: stored.events,
        };
        fs.writeFileSync(output, JSON.stringify(payload, null, 2));
      } else {
        const markdown = formatSessionAsMarkdown(stored.state, stored.events);
        fs.writeFileSync(output, markdown);
      }
      console.log(`Exported session ${stored.state.sessionId} to ${output} (${format})`);
    });
}
