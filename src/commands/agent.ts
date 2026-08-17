/**
 * Agent command — workspace-aware agent execution.
 */

import { Command } from 'commander';
import { AgentRuntime, detectWorkspaceRoot } from '../agent/runtime.js';
import { resolveAgent, resolveAgentFile, resolvePersistedAgent, type AgentDefinition } from '../agent/agents.js';
import { getDefaultModel, loadProjectConfig } from '../lib/config.js';
import { formatError, getChalk } from '../lib/output.js';
import { EventBus } from '../agent/events.js';
import { AgentRenderer } from '../ui/renderer.js';
import { buildAgentMcpConfig } from '../mcp/config.js';
import { McpManager } from '../mcp/manager.js';
import { defaultMode } from '../agent/mode.js';
import { SessionManager } from '../agent/sessions.js';
import type { AgentState } from '../agent/types.js';

export function registerAgentCommand(program: Command): Command {
  const agent = program
    .command('agent', { isDefault: true })
    .description('Run the workspace-aware Venice agent')
    .option('-p, --prompt <prompt>', 'Single noninteractive prompt')
    .option('-m, --model <model>', 'Model to use')
    .option('-a, --approval <mode>', 'Approval mode (suggest|auto-edit|auto|yolo; default: suggest interactive, auto-edit noninteractive)')
    .option('--auto', 'Shorthand for --approval auto (auto-approves workspace edits and known-safe tools; raw shell still prompts)')
    .option('--yolo', 'Shorthand for --approval yolo (autonomous execution; still prompts for destructive commands)')
    .option('--plan', 'Start in plan mode (read-only)', false)
    .option('--continue', 'Resume the most recent session in this workspace', false)
    .option('--session [sessionId]', 'Resume a session by id, or open the session picker if no id is given')
    .option('--cwd <cwd>', 'Working directory (defaults to git root or current directory)')
    .option('--max-turns <n>', 'Maximum agent turns', '25')
    .option('--output-format <format>', 'Output format for noninteractive mode (text|stream-json|json)', 'text')
    .option('--json', 'Output final result as JSON (deprecated: use --output-format json)')
    .option('--interactive', 'Render live progress (default when stdin is a TTY and --json is not used)')
    .option('--no-interactive', 'Force plain output even in a TTY')
    .option('--skills-dir <dir>', 'Additional skills directory (repeatable; additive — user and project skills are still loaded)', (value: string, previous: string[]) => [...previous, value], [] as string[])
    .option('--add-dir <dir>', 'Add an additional workspace root the agent may read and edit (repeatable)', (value: string, previous: string[]) => [...previous, value], [] as string[])
    .option('--agent <name>', 'Select a custom main agent by name (built-in, user, or project)')
    .option('--agent-file <path>', 'Load a custom main agent definition from a JSON or Markdown file')
    .action(async (options) => {
      const c = getChalk();
      const explicitApproval = options.approval !== undefined
        ? validateApprovalMode(String(options.approval))
        : undefined;
      if (options.approval !== undefined && !explicitApproval) {
        console.error(formatError(`Invalid approval mode: ${options.approval}`));
        process.exit(2);
      }
      // --yolo and --auto are shorthands; --yolo wins over --auto, and both
      // win over --approval.
      const requestedApproval = options.yolo
        ? 'yolo'
        : options.auto
          ? 'auto'
          : explicitApproval;

      const cwd = options.cwd ? String(options.cwd) : process.cwd();
      const workspaceRoot = detectWorkspaceRoot(cwd);
      // Project `.venice/config.json` supplies approval/validation/compaction
      // defaults below CLI flags but above global config (VCL-R3-010).
      const projectConfig = loadProjectConfig(workspaceRoot);

      // Custom main agent (VCL-R3-031): --agent-file loads a file directly;
      // --agent resolves a named definition (built-in, user, or project).
      let agent: AgentDefinition | undefined;
      if (options.agentFile) {
        agent = resolveAgentFile(String(options.agentFile), { workspaceRoot });
        if (!agent) {
          console.error(formatError(`Agent file not found or invalid: ${options.agentFile}`));
          process.exit(2);
        }
      } else if (options.agent) {
        agent = resolveAgent(String(options.agent), { workspaceRoot });
        if (!agent) {
          console.error(formatError(`Unknown agent: ${options.agent}. Use --agent-file to load a custom definition.`));
          process.exit(2);
        }
      }
      // A project-sourced agent is high-authority prompt configuration the
      // repo controls; surface that trust guidance explicitly (VCL-R3-031).
      if (agent?.source === 'project') {
        console.error(formatError(
          `Selected agent '${agent.name}' from the project (${agent.sourcePath}). ` +
          'Project agent definitions are high-authority prompt configuration: ' +
          'the repository controls this agent\'s system prompt.'
        ));
      }
      const maxTurns = Number.parseInt(options.maxTurns, 10);
      if (!Number.isInteger(maxTurns) || maxTurns < 1) {
        console.error(formatError('--max-turns must be a positive integer'));
        process.exit(2);
      }

      const outputFormat = options.json ? 'json' : options.outputFormat;
      const interactive = resolveInteractive(
        { prompt: options.prompt, interactive: options.interactive, json: options.json, outputFormat },
        { stdinTTY: process.stdin.isTTY, stdoutTTY: process.stdout.isTTY }
      );

      // Headless `-p` defaults to auto-edit so normal workspace edits can
      // proceed without a human approver; shell/network still prompt (and fail
      // closed with no approver). Interactive keeps `suggest` (VC-KIMI-017).
      // An explicit CLI flag wins; otherwise the project config's approvalMode
      // applies (yolo stays CLI-only so a shared repo cannot force autonomy).
      const approvalMode =
        requestedApproval ??
        (projectConfig.agent?.approvalMode && projectConfig.agent.approvalMode !== 'yolo'
          ? projectConfig.agent.approvalMode
          : resolveApprovalMode(undefined, interactive));

      if (!['text', 'stream-json', 'json'].includes(outputFormat)) {
        console.error(formatError(`Invalid output format: ${outputFormat}`));
        process.exit(2);
      }

      // One Kimi-compatible startup conflict validator (VCL-R3-029).
      const conflict = validateStartupConflicts(
        {
          prompt: options.prompt,
          plan: options.plan,
          yolo: options.yolo,
          auto: options.auto,
          continueFlag: options.continue,
          session: options.session,
          outputFormat,
          json: options.json,
          agent: options.agent,
          agentFile: options.agentFile,
        },
        !process.stdin.isTTY
      );
      if (conflict) {
        console.error(formatError(conflict));
        process.exit(2);
      }

      let resumeSessionId: string | undefined;
      if (options.continue) {
        const sessions = new SessionManager().list(workspaceRoot);
        resumeSessionId = sessions[0]?.sessionId;
        if (!resumeSessionId) {
          console.error(formatError('No saved session to continue'));
          process.exit(2);
        }
      } else if (options.session === true) {
        if (!interactive) {
          console.error(formatError('--session requires an id in noninteractive mode'));
          process.exit(2);
        }
      } else if (typeof options.session === 'string') {
        resumeSessionId = options.session;
      }

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

      // Project `.venice/mcp.json` may run arbitrary executables. It is only
      // merged after the user approves this workspace config (interactive) or
      // when a prior approval still matches the current file hash. In
      // noninteractive mode an untrusted project config is skipped.
      const mcpConfig = await buildAgentMcpConfig(workspaceRoot, { interactive });
      const mcpManager = new McpManager(mcpConfig);

      const mode = options.plan
        ? { ...defaultMode(approvalMode), operatingMode: 'plan' as const }
        : defaultMode(approvalMode);

      // When resuming without an explicit --agent/--agent-file, re-resolve the
      // persisted agent so its high-authority prompt is re-applied (VCL-R3-031).
      let storedSession: { state: AgentState; events: import('../agent/events.js').AgentEvent[] } | undefined;
      if (resumeSessionId) {
        storedSession = new SessionManager().load(resumeSessionId, workspaceRoot);
        if (!storedSession) {
          console.error(formatError(`Session not found in this workspace: ${resumeSessionId}`));
          process.exit(2);
        }
        if (!agent && storedSession.state.agent) {
          agent = resolvePersistedAgent(storedSession.state.agent, { workspaceRoot });
          if (agent?.source === 'project') {
            console.error(formatError(
              `Resumed agent '${agent.name}' from the project (${agent.sourcePath}). ` +
              'Project agent definitions are high-authority prompt configuration.'
            ));
          }
        }
      }

      if (interactive) {
        const { runTui } = await import('../ui/tui.js');
        await runTui({
          workspaceRoot,
          model: options.model || getDefaultModel(),
          approvalMode,
          mode,
          maxTurns,
          mcpManager,
          initialObjective: objective?.trim(),
          resumeSessionId,
          skillsDirs: options.skillsDir,
          additionalRoots: options.addDir,
          projectConfig,
          agent,
        });
        process.exit(0);
      }

      const events = new EventBus();
      const renderer = new AgentRenderer({ eventBus: events, interactive: false, outputFormat });
      renderer.start();

      const runtime = new AgentRuntime({
        workspaceRoot,
        objective: objective!.trim(),
        model: options.model || getDefaultModel(),
        approvalMode,
        mode,
        maxTurns,
        eventBus: events,
        mcpManager,
        skillsDirs: options.skillsDir,
        additionalRoots: options.addDir,
        projectConfig,
        agent,
      });

      // Broken skills must be visible during normal headless use, not only
      // via doctor/skills (VC-KIMI-043).
      const skillErrors = runtime.getSkillErrors();
      if (skillErrors.length > 0) {
        console.error(formatError(
          `${skillErrors.length} skill discovery error${skillErrors.length === 1 ? '' : 's'}:\n${skillErrors.map((e) => `  - ${e}`).join('\n')}`
        ));
      }

      if (storedSession) {
        // Explicit CLI flags win over the persisted session mode
        // (VC-KIMI-004: stored suggest -> CLI auto override).
        runtime.loadState(storedSession.state, { mode: { permissionMode: approvalMode } });
      }

      try {
        // Resumed sessions append the new prompt as a fresh user message
        // instead of replaying the stored objective (VC-KIMI-003).
        const result = resumeSessionId
          ? await runtime.resumeAndSend(objective!.trim())
          : await runtime.run();
        renderer.stop();
        if (outputFormat === 'stream-json') {
          // session.completed was already emitted by the renderer; no additional stdout
        } else if (outputFormat === 'json') {
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

/**
 * Enforce Kimi-compatible startup flag conflicts (VCL-R3-029).
 *
 * Returns an error message for an invalid combination, or null when the flags
 * are compatible. `hasStdin` is true when stdin is a pipe (so a non-text
 * output format can read a prompt from it instead of requiring --prompt).
 */
export function validateStartupConflicts(
  options: {
    prompt?: string;
    plan?: boolean;
    yolo?: boolean;
    auto?: boolean;
    continueFlag?: boolean;
    session?: string | boolean;
    outputFormat: string;
    json?: boolean;
    agent?: string;
    agentFile?: string;
  },
  hasStdin: boolean
): string | null {
  if (options.continueFlag && options.session !== undefined) {
    return '--continue and --session are mutually exclusive';
  }
  if (options.agent && options.agentFile) {
    return '--agent and --agent-file are mutually exclusive';
  }
  if (options.yolo && options.auto) {
    return '--yolo and --auto are mutually exclusive';
  }
  if (options.prompt && options.yolo) {
    return '--prompt and --yolo are mutually exclusive';
  }
  if (options.prompt && options.auto) {
    return '--prompt and --auto are mutually exclusive';
  }
  if (options.prompt && options.plan) {
    return '--prompt and --plan are mutually exclusive';
  }
  // Non-text output is for a single deterministic prompt; without one (and no
  // piped stdin to read), there is nothing to render.
  const resolvedFormat = options.json ? 'json' : options.outputFormat;
  if (resolvedFormat !== 'text' && !options.prompt && !hasStdin) {
    return '--output-format requires --prompt (or piped stdin)';
  }
  return null;
}

/**
 * Resolve the effective approval mode.
 *
 * Interactive runs default to `suggest`; noninteractive (`-p`/stdin) runs
 * default to `auto-edit` so workspace file edits can proceed without a human
 * approver (shell/network still fail closed). An explicit `--approval` always
 * wins (VC-KIMI-017).
 */
export function resolveApprovalMode(
  requested: 'suggest' | 'auto-edit' | 'auto' | 'yolo' | undefined,
  interactive: boolean
): 'suggest' | 'auto-edit' | 'auto' | 'yolo' {
  if (requested) return requested;
  return interactive ? 'suggest' : 'auto-edit';
}

/**
 * Decide whether the agent run should open the TUI (VCL-R3-007/008).
 *
 * A `-p/--prompt` run is never interactive by default, and any machine
 * output format (`json`/`stream-json`) forces headless behavior. Only a plain
 * text run on a TTY with no prompt is interactive. An explicit
 * `--interactive`/`--no-interactive` flag always wins.
 */
export function resolveInteractive(
  options: {
    prompt?: string;
    interactive?: boolean;
    json?: boolean;
    outputFormat?: string;
  },
  env: { stdinTTY: boolean; stdoutTTY: boolean }
): boolean {
  if (options.interactive !== undefined) return options.interactive;
  const promptMode = options.prompt !== undefined;
  const outputFormat = options.json ? 'json' : options.outputFormat;
  return !promptMode && env.stdinTTY && env.stdoutTTY && outputFormat === 'text';
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

