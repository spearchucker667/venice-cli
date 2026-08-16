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
import { ModelPicker } from './model-picker.js';
import { SessionPicker } from './session-picker.js';
import { SessionManager } from '../agent/sessions.js';

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

type PickerMode = 'normal' | 'model-picker' | 'session-picker';

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
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [currentModel, setCurrentModel] = useState(model);
  const [mode, setMode] = useState<PickerMode>('normal');

  useInput((_input, key) => {
    const k = key as { ctrl?: boolean; name?: string; escape?: boolean };
    if (k.ctrl && k.name === 'c') {
      abortControllerRef.current?.abort();
      runtimeRef.current?.complete().catch(() => {});
      exit();
      onExit();
      return;
    }
    if (k.escape && mode !== 'normal') {
      setMode('normal');
    }
  });

  permissionsRef.current.setApprover((toolName, input, risk) => {
    return new Promise<ApprovalDecision>((resolve) => {
      setPendingApproval({ toolName, input, risk, resolve });
    });
  });

  useEffect(() => {
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const events = new EventBus();
    let runtime: AgentRuntime;

    const unsubscribe = events.on((event: AgentEvent) => {
      const mapped = mapEventToMessage(event);
      if (mapped) {
        setMessages((prev) => [...prev, mapped]);
      }
      if (event.type === 'session_started' || event.type === 'session_completed') {
        setStatus(runtime?.getState().status ?? 'idle');
      }
    });

    runtime = new AgentRuntimeClass({
      workspaceRoot,
      objective: initialObjective || '',
      model: currentModel,
      approvalMode,
      maxTurns,
      eventBus: events,
      mcpManager,
      signal: controller.signal,
      permissionManager: permissionsRef.current,
    });
    runtimeRef.current = runtime;

    if (initialObjective?.trim()) {
      setIsRunning(true);
      runtime
        .sendUserMessage(initialObjective.trim())
        .then(() => {
          setStatus(runtime.getState().status);
          setIsRunning(false);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : String(err));
          setStatus('failed');
          setIsRunning(false);
        });
    } else {
      runtime.start().catch(() => {});
    }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceRoot, model, approvalMode, maxTurns, mcpManager]);

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

  const handleSetModel = (nextModel: string) => {
    setCurrentModel(nextModel);
    runtimeRef.current?.setModel(nextModel);
  };

  const handleResumeSession = (sessionId: string) => {
    const manager = new SessionManager();
    const stored = manager.load(sessionId, workspaceRoot);
    if (!stored) {
      addEvent(`Session not found in this workspace: ${sessionId}`);
      return;
    }
    runtimeRef.current?.loadState(stored.state);
    setCurrentModel(stored.state.model);
    setStatus(stored.state.status);
    addEvent(`Resumed session ${sessionId}: ${stored.state.objective || 'No objective'}`);
  };

  const handleSubmit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const slash = parseSlashCommand(trimmed);
    if (slash) {
      handleSlashCommand(slash.command, slash.args, {
        exit: () => {
          runtimeRef.current?.complete().catch(() => {});
          exit();
          onExit();
        },
        setMessages,
        status,
        model: currentModel,
        approvalMode,
        workspaceRoot,
        setModel: handleSetModel,
        showModelPicker: () => setMode('model-picker'),
        showSessionPicker: () => setMode('session-picker'),
        resumeSession: handleResumeSession,
        listSessions: () => new SessionManager().list(workspaceRoot),
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
    setIsRunning(true);
    setError(undefined);

    runtimeRef.current
      ?.sendUserMessage(resolvedText)
      .then(() => {
        setStatus(runtimeRef.current?.getState().status ?? 'idle');
        setIsRunning(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setStatus('failed');
        setIsRunning(false);
      });
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
      {mode === 'model-picker' && (
        <ModelPicker
          currentModel={currentModel}
          onSelect={(selected) => {
            handleSetModel(selected);
            addEvent(`Model set to ${selected}.`);
            setMode('normal');
          }}
        />
      )}
      {mode === 'session-picker' && (
        <SessionPicker
          workspaceRoot={workspaceRoot}
          onSelect={(sessionId) => {
            handleResumeSession(sessionId);
            setMode('normal');
          }}
        />
      )}
      {pendingApproval && mode === 'normal' && (
        <ApprovalPrompt
          toolName={pendingApproval.toolName}
          input={pendingApproval.input}
          risk={pendingApproval.risk}
          onDecision={handleApprovalDecision}
        />
      )}
      <Composer onSubmit={handleSubmit} disabled={pendingApproval !== null || mode !== 'normal'} />
      <StatusBar
        state={{
          messages,
          status,
          model: currentModel,
          workspaceRoot,
          approvalMode,
          contextTokens: 0,
          maxTokens: 128000,
        }}
      />
    </Box>
  );
}
