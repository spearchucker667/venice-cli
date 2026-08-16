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
import type { ApprovalMode } from '../agent/permissions.js';
import { shellTool } from '../tools/shell/execute.js';
import type { ToolContext } from '../tools/types.js';
import { Composer } from './composer.js';
import { Transcript } from './transcript.js';
import { StatusBar } from './status.js';
import { ApprovalPrompt, type ApprovalDecision } from './approval.js';
import { mapEventToMessage } from './events.js';
import { parseSlashCommand } from './slash-commands.js';
import { handleSlashCommand } from './slash-handlers.js';
import { resolveMentions, readMentionedFiles } from './mentions.js';
import type { TuiMessage } from './types.js';
import { ModelPicker } from './model-picker.js';
import { SessionPicker } from './session-picker.js';
import { SessionManager } from '../agent/sessions.js';
import type { ModelProfile } from '../agent/model-profile.js';

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

function useStdoutDimensions() {
  const [dimensions, setDimensions] = useState({
    columns: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  });

  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        columns: process.stdout.columns || 80,
        rows: process.stdout.rows || 24,
      });
    };
    process.stdout.on('resize', handleResize);
    return () => {
      process.stdout.off('resize', handleResize);
    };
  }, []);

  return dimensions;
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

import { execSync } from 'child_process';

function getGitBranch(cwd: string): string | undefined {
  try {
    return execSync('git branch --show-current', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
  } catch {
    return undefined;
  }
}

export function App({ workspaceRoot, model, approvalMode, maxTurns, mcpManager, initialObjective, onExit }: AppProps): JSX.Element {
  const { exit } = useApp();
  const abortControllerRef = useRef<AbortController | null>(null);
  const runtimeRef = useRef<AgentRuntime | null>(null);
  const permissionsRef = useRef<PermissionManager>(new PermissionManager(approvalMode));

  const [messages, setMessages] = useState<TuiMessage[]>([]);
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [isRunning, setIsRunning] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [currentModel, setCurrentModel] = useState(model);
  const [currentModelProfile, setCurrentModelProfile] = useState<ModelProfile | undefined>();
  const [currentApprovalMode, setCurrentApprovalMode] = useState<ApprovalMode>(approvalMode);
  const [mode, setMode] = useState<PickerMode>('normal');
  const [gitBranch] = useState(() => getGitBranch(workspaceRoot));

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      if (isRunning && runtimeRef.current) {
        addEvent('Operation cancelled by user.');
        setIsRunning(false);
        abortControllerRef.current?.abort(new Error('Cancelled by user'));
        const newController = new AbortController();
        abortControllerRef.current = newController;
        runtimeRef.current.updateSignal(newController.signal);
        setStatus('cancelled');
      } else {
        runtimeRef.current?.complete().catch(() => {});
        exit();
        onExit();
      }
      return;
    }
    if (key.escape && mode !== 'normal') {
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
      if (event.type === 'model_profile_updated') {
        setCurrentModelProfile(event.profile);
      }
      if (event.type === 'model_request') setStatus('thinking');
      if (event.type === 'approval_requested') setStatus('awaiting_approval');
      if (event.type === 'tool_started') setStatus('executing_tool');
      if (event.type === 'validation_started') setStatus('verifying');
      const mapped = mapEventToMessage(event);
      if (mapped) {
        setMessages((prev) => {
          const toolCallId = mapped.metadata?.toolCallId;
          const withoutPending = event.type === 'tool_completed' && toolCallId
            ? prev.filter((message) => !(message.metadata?.toolCallId === toolCallId && message.metadata?.pending === true))
            : prev;
          return [...withoutPending, mapped];
        });
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
      runtimeRef.current?.shutdown().catch(() => {});
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
      signal: abortControllerRef.current?.signal,
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

  const handleSetModel = async (nextModel: string, profile?: ModelProfile): Promise<ModelProfile | undefined> => {
    setCurrentModel(nextModel);
    runtimeRef.current?.setModel(nextModel);
    if (profile) {
      setCurrentModelProfile(profile);
      runtimeRef.current?.setModelProfile(profile);
    } else {
      const discovered = await runtimeRef.current?.refreshModelProfile().catch(() => undefined);
      setCurrentModelProfile(discovered);
      return discovered;
    }
    return profile;
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
    setCurrentModelProfile(stored.state.modelProfile);
    setStatus(stored.state.status);
    runtimeRef.current?.refreshModelProfile().then((profile) => {
      if (profile) setCurrentModelProfile(profile);
    }).catch(() => {});
    const restoredMessages: TuiMessage[] = stored.state.messages.slice(-50).flatMap((message, index) => {
      if (message.role !== 'user' && message.role !== 'assistant') return [];
      return [{
        id: `restored-${index}`,
        role: message.role,
        content: typeof message.content === 'string' ? message.content : '[multimodal message]',
      }];
    });
    setMessages([
      ...restoredMessages,
      {
        id: `resume-${sessionId}`,
        role: 'event',
        content: `Resumed session ${sessionId} · ${stored.state.messages.length} messages restored`,
      },
    ]);
  };

  const handleSubmit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const slash = parseSlashCommand(trimmed);
    if (slash) {
      await handleSlashCommand(slash.command, slash.args, {
        exit: () => {
          runtimeRef.current?.complete().catch(() => {});
          exit();
          onExit();
        },
        setMessages,
        status,
        model: currentModel,
        approvalMode: currentApprovalMode,
        setApprovalMode: setCurrentApprovalMode,
        workspaceRoot,
        setModel: handleSetModel,
        showModelPicker: () => setMode('model-picker'),
        showSessionPicker: () => setMode('session-picker'),
        resumeSession: handleResumeSession,
        listSessions: () => new SessionManager().list(workspaceRoot),
        mcpManager,
        getRuntime: () => runtimeRef.current ?? undefined,
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
    let attachedContext: string | undefined;

    if (mentions.length) {
      addEvent(`Attached files: ${mentions.join(', ')}`);
      attachedContext = await readMentionedFiles(workspaceRoot, mentions);
    }

    setMessages((prev) => [...prev, { id: String(prev.length + 1), role: 'user', content: resolvedText }]);
    setIsRunning(true);
    setError(undefined);

    runtimeRef.current
      ?.sendUserMessage(resolvedText, attachedContext)
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

  const { columns, rows } = useStdoutDimensions();

  return (
    <Box flexDirection="column" height={rows} width={columns}>
      <Transcript messages={messages} maxMessages={Math.max(3, rows - 8)} />
      {error && (
        <Box paddingX={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}
      {mode === 'model-picker' && (
        <ModelPicker
          limit={Math.max(3, Math.min(8, rows - 12))}
          columns={columns}
          currentModel={currentModel}
          onSelect={(selected, profile) => {
            handleSetModel(selected, profile).catch(() => {});
            addEvent(profile.mode === 'chat-only'
              ? `Model set to ${selected}. Chat only — agent tools unavailable.`
              : `Model set to ${selected}. Agent tools enabled.`);
            setMode('normal');
          }}
        />
      )}
      {mode === 'session-picker' && (
        <SessionPicker
          limit={Math.max(3, Math.min(6, rows - 12))}
          columns={columns}
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
      <Composer
        onSubmit={handleSubmit}
        workspaceRoot={workspaceRoot}
        disabled={pendingApproval !== null || mode !== 'normal'}
        maxSuggestions={Math.max(3, Math.min(8, rows - 11))}
        columns={columns}
      />
      <StatusBar
        columns={columns}
        state={{
          messages,
          status,
          model: currentModel,
          agentMode: currentModelProfile?.mode ?? runtimeRef.current?.getState().agentMode ?? 'agent',
          modelProfile: currentModelProfile ?? runtimeRef.current?.getState().modelProfile,
          workspaceRoot,
          approvalMode: currentApprovalMode,
          contextTokens: runtimeRef.current?.getContextManager().estimateTokens() ?? 0,
          maxTokens: runtimeRef.current?.getContextManager().getMaxTokens() ?? 0,
          gitBranch,
        }}
      />
    </Box>
  );
}
