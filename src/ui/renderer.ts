/**
 * Simple event-driven terminal renderer for the agent runtime.
 *
 * This is a foundation for the interactive TUI. It subscribes to the agent
 * event bus and prints human-readable progress to the terminal. It keeps all
 * business logic out of the rendering layer.
 */

import type { AgentEvent } from '../agent/events.js';
import { EventBus } from '../agent/events.js';
import { getChalk } from '../lib/output.js';
import { toStreamJson, serializeStreamJson, buildTerminalResult } from '../agent/stream-json.js';
import { getTheme } from './theme.js';

export interface RendererOptions {
  eventBus: EventBus;
  interactive?: boolean;
  json?: boolean;
  outputFormat?: 'text' | 'stream-json' | 'json';
}

export class AgentRenderer {
  private readonly eventBus: EventBus;
  private readonly interactive: boolean;
  private readonly outputFormat: 'text' | 'stream-json' | 'json';
  private unsubscribe?: () => void;
  // Envelope correlation state (VCL-R3-011): every emitted line carries a
  // monotonic sequence, the session id, and the id of the active turn.
  private sequence = 0;
  private sessionId = '';
  private turnId: string | undefined;
  // Final assistant text of the current run, carried by the terminal record.
  private finalText = '';

  constructor(options: RendererOptions) {
    this.eventBus = options.eventBus;
    this.interactive = options.interactive ?? false;
    this.outputFormat = options.outputFormat ?? (options.json ? 'json' : 'text');
  }

  start(): void {
    this.unsubscribe = this.eventBus.on((event) => this.render(event));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private render(event: AgentEvent): void {
    const c = getChalk();
    if (this.outputFormat === 'stream-json') {
      if (event.type === 'session_started') this.sessionId = event.sessionId;
      // R2-011: correlate records to the real turn id — prefer the event's own
      // turn id (model_request now carries it); previously the renderer
      // synthesized the turn id from an unrelated event id (VCL-052).
      if ('turnId' in event && event.turnId) this.turnId = event.turnId;
      if (event.type === 'assistant_complete') this.finalText = event.content;
      const streamEvent = toStreamJson(event, {
        sessionId: this.sessionId,
        sequence: this.sequence++,
        turnId: this.turnId,
      });
      if (streamEvent) {
        console.log(serializeStreamJson(streamEvent));
      }
      // R2-011: exactly one authoritative terminal record per run, carrying
      // status, final text, and an explicit incomplete reason.
      if (event.type === 'session_completed') {
        console.log(serializeStreamJson(buildTerminalResult(event, {
          sessionId: this.sessionId,
          sequence: this.sequence++,
          turnId: this.turnId,
        }, this.finalText)));
      }
      return;
    }

    const out = this.outputFormat === 'json' ? console.error : console.log;
    switch (event.type) {
      case 'session_started':
        out(c.bold(`▶ ${event.objective}`));
        break;
      case 'model_request':
        if (this.interactive) out(c.dim('  thinking…'));
        break;
      case 'tool_requested':
        out(c.cyan(`  • ${event.toolName}`));
        break;
      case 'tool_completed': {
        const ok = (event.result as { ok?: boolean })?.ok;
        out(ok ? c.green('    ✓ done') : c.red('    ✗ failed'));
        break;
      }
      case 'subagent_started':
        out(c.magenta(`  ↳ ${event.mode} subagent ${event.kind}: ${event.task}`));
        break;
      case 'subagent_completed':
        out(c.magenta(`    ↳ ${event.status} (${event.findings} findings, ${event.filesInspected} inspected, ${event.changedFiles} changed)`));
        break;
      case 'approval_requested':
        out(c.yellow(`  ? approval required: ${event.toolName}`));
        break;
      case 'file_changed':
        out(getTheme().primary(`  ~ ${event.path}`));
        break;
      case 'context_compacted':
        out(c.dim('  … context compacted'));
        break;
      case 'session_completed':
        out(c.bold(`● ${event.status}`));
        break;
      case 'session_persist_failed':
        out(c.red(`⚠ Session save failed: ${event.message}`));
        break;
      case 'model_catalog_failed':
        out(c.yellow(`⚠ Model discovery failed: ${event.message}`));
        break;
      case 'balance_remaining':
        out(c.dim(`🔋 x402 credits remaining: $${event.balanceUsd.toFixed(4)}`));
        break;
    }
  }
}
