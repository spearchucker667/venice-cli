/**
 * Agent command — workspace-aware agent execution.
 */

import { Command } from 'commander';
import { AgentRuntime, detectWorkspaceRoot } from '../agent/runtime.js';
import { getDefaultModel } from '../lib/config.js';
import { formatError, getChalk } from '../lib/output.js';
import { EventBus } from '../agent/events.js';
import { AgentRenderer } from '../ui/renderer.js';
import { loadMcpConfig, getWorkspaceMcpConfigPath } from '../mcp/config.js';
import { McpManager } from '../mcp/manager.js';

export function registerAgentCommand(program: Command): Command {
  const agent = program
    .command('agent', { isDefault: true })
    .description('Run the workspace-aware Venice agent')
    .option('-p, --prompt <prompt>', 'Single noninteractive prompt')
    .option('-m, --model <model>', 'Model to use')
    .option('-a, --approval <mode>', 'Approval mode (suggest|auto-edit|auto|yolo)', 'suggest')
    .option('--cwd <cwd>', 'Working directory (defaults to git root or current directory)')
    .option('--max-turns <n>', 'Maximum agent turns', '25')
    .option('--json', 'Output final result as JSON')
    .option('--interactive', 'Render live progress (default when stdin is a TTY and --json is not used)')
    .option('--no-interactive', 'Force plain output even in a TTY')
    .action(async (options) => {
      const c = getChalk();
      const approvalMode = validateApprovalMode(options.approval);
      if (!approvalMode) {
        console.error(formatError(`Invalid approval mode: ${options.approval}`));
        process.exit(2);
      }

      const cwd = options.cwd ? String(options.cwd) : process.cwd();
      const workspaceRoot = detectWorkspaceRoot(cwd);
      const maxTurns = Number.parseInt(options.maxTurns, 10);
      if (!Number.isInteger(maxTurns) || maxTurns < 1) {
        console.error(formatError('--max-turns must be a positive integer'));
        process.exit(2);
      }

      const interactive = options.interactive ?? (process.stdin.isTTY && process.stdout.isTTY && !options.json);

      let objective: string | undefined;
      if (options.prompt) {
        objective = String(options.prompt);
      } else if (!interactive && !process.stdin.isTTY) {
        objective = await readStdin();
      }

      if (!interactive && !objective?.trim()) {
        console.error(formatError('No prompt provided.'));
        process.exit(2);
      }

      const mcpConfig = loadMcpConfig(undefined, getWorkspaceMcpConfigPath(workspaceRoot));
      const mcpManager = new McpManager(mcpConfig);

      if (interactive) {
        const { runTui } = await import('../ui/tui.js');
        await runTui({
          workspaceRoot,
          model: options.model || getDefaultModel(),
          approvalMode,
          maxTurns,
          mcpManager,
          initialObjective: objective?.trim(),
        });
        process.exit(0);
      }

      const events = new EventBus();
      const renderer = new AgentRenderer({ eventBus: events, interactive: false, json: !!options.json });
      renderer.start();

      const runtime = new AgentRuntime({
        workspaceRoot,
        objective: objective!.trim(),
        model: options.model || getDefaultModel(),
        approvalMode,
        maxTurns,
        eventBus: events,
        mcpManager,
      });

      try {
        const result = await runtime.run();
        renderer.stop();
        if (options.json) {
          console.log(JSON.stringify({
            finalMessage: result.finalMessage,
            status: result.state.status,
            changedFiles: result.state.changedFiles,
            todos: result.state.todos,
          }, null, 2));
        } else {
          console.log('\n' + c.bold('Result:'));
          console.log(result.finalMessage);
          if (result.state.changedFiles.length) {
            console.log('\n' + c.bold('Changed files:'));
            for (const file of result.state.changedFiles) console.log(`  ${file}`);
          }
        }
        await mcpManager.stop();
        process.exit(result.state.status === 'complete' ? 0 : 1);
      } catch (error) {
        renderer.stop();
        await mcpManager.stop().catch(() => {});
        console.error(formatError(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  return agent;
}

function validateApprovalMode(mode: string): 'suggest' | 'auto-edit' | 'auto' | 'yolo' | undefined {
  if (['suggest', 'auto-edit', 'auto', 'yolo'].includes(mode)) {
    return mode as 'suggest' | 'auto-edit' | 'auto' | 'yolo';
  }
  return undefined;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

