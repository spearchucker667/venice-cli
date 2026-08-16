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
import { toStreamJson, serializeStreamJson } from '../agent/stream-json.js';

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
      const streamEvent = toStreamJson(event);
      if (streamEvent) {
        console.log(serializeStreamJson(streamEvent));
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
        out(c.blue(`  ~ ${event.path}`));
        break;
      case 'context_compacted':
        out(c.dim('  … context compacted'));
        break;
      case 'session_completed':
        out(c.bold(`● ${event.status}`));
        break;
    }
  }
}
