/**
 * Top-level Ink app for the Venice agent TUI.
 */

import { useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { AgentRuntime } from '../agent/runtime.js';
import { AgentRuntime as AgentRuntimeClass } from '../agent/runtime.js';
import type { AgentState, AgentStatus } from '../agent/types.js';
import type { AgentEvent } from '../agent/events.js';
import { EventBus } from '../agent/events.js';
import type { McpManager } from '../mcp/manager.js';
import { PermissionManager } from '../agent/permissions.js';
import { shellTool } from '../tools/shell/execute.js';
import type { ToolContext } from '../tools/types.js';
import { Composer } from './composer.js';
import { Transcript } from './transcript.js';
import { StatusBar } from './status.js';
import { ApprovalPrompt, type ApprovalDecision } from './approval.js';
import { mapEventToMessage } from './events.js';
import { parseSlashCommand } from './slash-commands.js';
import { handleSlashCommand } from './slash-handlers.js';
import { resolveMentions } from './mentions.js';
import type { TuiMessage } from './types.js';

export interface AppProps {
  workspaceRoot: string;
  model: string;
  approvalMode: 'suggest' | 'auto-edit' | 'auto' | 'yolo';
  maxTurns: number;
  mcpManager?: McpManager;
  initialObjective?: string;
  onExit: () => void;
}

interface PendingApproval {
  toolName: string;
  input: unknown;
  risk: string;
  resolve: (decision: ApprovalDecision) => void;
}

function minimalAgentState(workspaceRoot: string): AgentState {
  return {
    sessionId: 'tui',
    workspaceRoot,
    model: '',
    objective: '',
    status: 'idle',
    messages: [],
    todos: [],
    relevantFiles: [],
    changedFiles: [],
    toolHistory: [],
    skillSummaries: [],
    activeSkills: [],
  };
}

export function App({ workspaceRoot, model, approvalMode, maxTurns, mcpManager, initialObjective, onExit }: AppProps): JSX.Element {
  const { exit } = useApp();
  const abortControllerRef = useRef<AbortController | null>(null);
  const runtimeRef = useRef<AgentRuntime | null>(null);
  const permissionsRef = useRef<PermissionManager>(new PermissionManager(approvalMode));

  const [messages, setMessages] = useState<TuiMessage[]>([
    { id: 'welcome', role: 'system', content: 'Venice Agent — type /help for commands or enter a task.' },
  ]);
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [isRunning, setIsRunning] = useState(false);
  const [objective, setObjective] = useState<string | undefined>(initialObjective);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  useInput((_input, key) => {
    const k = key as { ctrl?: boolean; name?: string };
    if (k.ctrl && k.name === 'c') {
      abortControllerRef.current?.abort();
      exit();
      onExit();
    }
  });

  permissionsRef.current.setApprover((toolName, input, risk) => {
    return new Promise<ApprovalDecision>((resolve) => {
      setPendingApproval({ toolName, input, risk, resolve });
    });
  });

  useEffect(() => {
    if (!objective) return;

    setIsRunning(true);
    setStatus('thinking');
    setError(undefined);
    setPendingApproval((current) => {
      if (current) {
        current.resolve({ approved: false });
      }
      return null;
    });

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const events = new EventBus();
    let runtime: AgentRuntime;

    const unsubscribe = events.on((event: AgentEvent) => {
      const mapped = mapEventToMessage(event);
      if (mapped) {
        setMessages((prev) => [...prev, mapped]);
      }
      if (event.type === 'session_completed' || event.type === 'session_started') {
        setStatus(runtime?.getState().status ?? 'idle');
      }
    });

    runtime = new AgentRuntimeClass({
      workspaceRoot,
      objective,
      model,
      approvalMode,
      maxTurns,
      eventBus: events,
      mcpManager,
      signal: controller.signal,
      permissionManager: permissionsRef.current,
    });
    runtimeRef.current = runtime;

    runtime
      .run()
      .then(() => {
        setStatus(runtime.getState().status);
        setIsRunning(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setStatus('failed');
        setIsRunning(false);
      });

    return () => {
      unsubscribe();
      controller.abort();
      runtimeRef.current = null;
      setPendingApproval((current) => {
        if (current) {
          current.resolve({ approved: false });
        }
        return null;
      });
    };
  }, [objective, workspaceRoot, model, approvalMode, maxTurns, mcpManager]);

  const addEvent = (content: string) => {
    setMessages((prev) => [...prev, { id: String(prev.length + 1), role: 'event', content }]);
  };

  const handleShellPassthrough = async (command: string) => {
    addEvent(`$ ${command}`);
    const decision = await permissionsRef.current.requestApproval('shell', { command }, 'execute');
    if (!decision.approved) {
      addEvent('Shell command denied.');
      return;
    }
    const context: ToolContext = {
      workspaceRoot,
      sessionId: runtimeRef.current?.getState().sessionId || 'tui',
      objective: runtimeRef.current?.getState().objective || '',
      runtimeState: runtimeRef.current?.getState() ?? minimalAgentState(workspaceRoot),
    };
    const result = await shellTool.execute({ command }, context);
    if (result.ok) {
      const output = result.data as { stdout?: string; stderr?: string; exitCode?: number | null };
      addEvent(`exit ${output.exitCode ?? '?'}`);
      if (output.stdout) addEvent(output.stdout);
      if (output.stderr) addEvent(output.stderr);
    } else {
      addEvent(`Error: ${result.error?.message || 'shell failed'}`);
    }
  };

  const handleSubmit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const slash = parseSlashCommand(trimmed);
    if (slash) {
      handleSlashCommand(slash.command, slash.args, {
        exit: () => {
          exit();
          onExit();
        },
        setMessages,
        status,
        model,
        approvalMode,
        workspaceRoot,
      });
      return;
    }

    if (trimmed.startsWith('!')) {
      const command = trimmed.slice(1).trim();
      if (command) {
        handleShellPassthrough(command).catch((err) => addEvent(String(err)));
      }
      return;
    }

    if (isRunning) {
      addEvent('Wait for the current task to finish, or press Ctrl+C to cancel.');
      return;
    }

    const { text: resolvedText, mentions } = resolveMentions(trimmed);
    if (mentions.length) {
      addEvent(`Attached files: ${mentions.join(', ')}`);
    }

    setMessages((prev) => [...prev, { id: String(prev.length + 1), role: 'user', content: resolvedText }]);
    setObjective(resolvedText);
  };

  const handleApprovalDecision = (decision: ApprovalDecision) => {
    pendingApproval?.resolve(decision);
    setPendingApproval(null);
  };

  return (
    <Box flexDirection="column" height="100%">
      <Transcript messages={messages} />
      {error && (
        <Box paddingX={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}
      {pendingApproval && (
        <ApprovalPrompt
          toolName={pendingApproval.toolName}
          input={pendingApproval.input}
          risk={pendingApproval.risk}
          onDecision={handleApprovalDecision}
        />
      )}
      <Composer onSubmit={handleSubmit} disabled={isRunning && pendingApproval !== null} />
      <StatusBar
        state={{
          messages,
          status,
          model,
          workspaceRoot,
          approvalMode,
          contextTokens: 0,
          maxTokens: 128000,
        }}
      />
    </Box>
  );
}
