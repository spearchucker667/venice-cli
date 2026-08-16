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

export interface RendererOptions {
  eventBus: EventBus;
  interactive?: boolean;
}

export class AgentRenderer {
  private readonly eventBus: EventBus;
  private readonly interactive: boolean;
  private unsubscribe?: () => void;

  constructor(options: RendererOptions) {
    this.eventBus = options.eventBus;
    this.interactive = options.interactive ?? false;
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
    switch (event.type) {
      case 'session_started':
        console.log(c.bold(`▶ ${event.objective}`));
        break;
      case 'model_request':
        if (this.interactive) console.log(c.dim('  thinking…'));
        break;
      case 'tool_requested':
        console.log(c.cyan(`  • ${event.toolName}`));
        break;
      case 'tool_completed': {
        const ok = (event.result as { ok?: boolean })?.ok;
        console.log(ok ? c.green('    ✓ done') : c.red('    ✗ failed'));
        break;
      }
      case 'subagent_started':
        console.log(c.magenta(`  ↳ ${event.mode} subagent ${event.kind}: ${event.task}`));
        break;
      case 'subagent_completed':
        console.log(c.magenta(`    ↳ ${event.status} (${event.findings} findings, ${event.filesInspected} inspected, ${event.changedFiles} changed)`));
        break;
      case 'approval_requested':
        console.log(c.yellow(`  ? approval required: ${event.toolName}`));
        break;
      case 'file_changed':
        console.log(c.blue(`  ~ ${event.path}`));
        break;
      case 'context_compacted':
        console.log(c.dim('  … context compacted'));
        break;
      case 'session_completed':
        console.log(c.bold(`● ${event.status}`));
        break;
    }
  }
}
