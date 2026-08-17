/**
 * Top-level Ink app for the Venice agent TUI.
 */

import { useEffect, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { AgentRuntime } from '../agent/runtime.js';
import { AgentRuntime as AgentRuntimeClass } from '../agent/runtime.js';
import type { AgentDefinition } from '../agent/agents.js';
import type { AgentStatus } from '../agent/types.js';
import type { AgentEvent } from '../agent/events.js';
import { EventBus } from '../agent/events.js';
import type { McpManager } from '../mcp/manager.js';
import { PermissionManager } from '../agent/permissions.js';
import type { ApprovalMode } from '../agent/permissions.js';
import type { ProjectAgentConfig } from '../lib/config.js';
import { Composer } from './composer.js';
import { Transcript } from './transcript.js';
import { Greeting } from './greeting.js';
import { resolveGreetingPolicy } from './brand.js';
import { StatusBar } from './status.js';
import { ApprovalPrompt, type ApprovalDecision } from './approval.js';
import { PlanApprovalPrompt } from './plan-approval.js';
import { UserQuestionPrompt } from './user-question.js';
import { mapEventToMessage } from './events.js';
import { parseSlashCommand } from './slash-commands.js';
import { handleSlashCommand } from './slash-handlers.js';
import { resolveMentions, readMentionedFiles } from './mentions.js';
import type { TuiMessage } from './types.js';
import { ModelPicker } from './model-picker.js';
import { SessionPicker } from './session-picker.js';
import { SessionManager } from '../agent/sessions.js';
import type { ModelProfile } from '../agent/model-profile.js';
import type { RuntimeModeState } from '../agent/mode.js';
import type { PlanArtifact, UserQuestionRequest, UserQuestionResponse } from '../agent/types.js';

export interface AppProps {
  workspaceRoot: string;
  model: string;
  approvalMode: 'suggest' | 'auto-edit' | 'auto' | 'yolo';
  mode?: RuntimeModeState;
  maxTurns: number;
  mcpManager?: McpManager;
  initialObjective?: string;
  resumeSessionId?: string;
  skillsDirs?: string[];
  additionalRoots?: string[];
  /** Project `.venice/config.json` defaults (VCL-R3-010). */
  projectConfig?: ProjectAgentConfig;
  /** Selected custom main agent (VCL-R3-031). */
  agent?: AgentDefinition;
  onExit: () => void;
}

interface PendingApproval {
  toolName: string;
  input: unknown;
  risk: string;
  resolve: (decision: ApprovalDecision) => void;
}

interface PendingPlanApproval {
  plan: PlanArtifact;
  resolve: (approved: boolean) => void;
}

interface PendingUserQuestion {
  request: UserQuestionRequest;
  resolve: (response: UserQuestionResponse | undefined) => void;
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

import { execSync } from 'child_process';

function getGitBranch(cwd: string): string | undefined {
  try {
    return execSync('git branch --show-current', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
  } catch {
    return undefined;
  }
}

export function App({ workspaceRoot, model, approvalMode, mode: initialMode, maxTurns, mcpManager, initialObjective, resumeSessionId, skillsDirs, additionalRoots, projectConfig, agent, onExit }: AppProps): JSX.Element {
  const { exit } = useApp();
  const abortControllerRef = useRef<AbortController | null>(null);
  const runtimeRef = useRef<AgentRuntime | null>(null);
  const permissionsRef = useRef<PermissionManager>(new PermissionManager(approvalMode));

  const [messages, setMessages] = useState<TuiMessage[]>([]);
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [isRunning, setIsRunning] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [pendingPlanApproval, setPendingPlanApproval] = useState<PendingPlanApproval | null>(null);
  const [pendingUserQuestion, setPendingUserQuestion] = useState<PendingUserQuestion | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [currentModel, setCurrentModel] = useState(model);
  const [currentModelProfile, setCurrentModelProfile] = useState<ModelProfile | undefined>();
  const [currentApprovalMode, setCurrentApprovalMode] = useState<ApprovalMode>(approvalMode);
  const [pickerMode, setPickerMode] = useState<PickerMode>('normal');
  const [inputMode, setInputMode] = useState<'agent' | 'shell'>('agent');
  const [operatingMode, setOperatingMode] = useState<'agent' | 'plan'>('agent');
  const [queuedCount, setQueuedCount] = useState(0);
  const [greetingVisible, setGreetingVisible] = useState(true);
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
    if (key.shift && key.tab) {
      const runtime = runtimeRef.current;
      if (runtime) {
        const next = operatingMode === 'plan' ? 'agent' : 'plan';
        runtime.setMode({ operatingMode: next });
      }
      return;
    }
    if (key.ctrl && input === 'x') {
      const runtime = runtimeRef.current;
      if (runtime) {
        const next = inputMode === 'shell' ? 'agent' : 'shell';
        runtime.setMode({ inputMode: next });
        if (next === 'shell') {
          addEvent('⚠ Shell commands run with your OS account privileges and are not filesystem-sandboxed.');
        } else {
          addEvent('Agent mode.');
        }
      }
      return;
    }
    if (key.escape && pickerMode !== 'normal') {
      setPickerMode('normal');
    }
  });

  permissionsRef.current.setApprover((toolName, input, risk) => {
    return new Promise<ApprovalDecision>((resolve) => {
      setPendingApproval({ toolName, input, risk, resolve });
    });
  });

  // Plan-exit approval is a separate policy from tool approval; YOLO does
  // not bypass it (work order §9 rule 7).
  permissionsRef.current.setPlanApprover((plan) => {
    return new Promise<boolean>((resolve) => {
      setPendingPlanApproval({ plan, resolve });
    });
  });

  // Structured ask_user questions collect a real answer from the TUI
  // (VC-KIMI-058); resolving undefined reports INTERACTION_REQUIRED.
  permissionsRef.current.setUserQuestionHandler((request) => {
    return new Promise<UserQuestionResponse | undefined>((resolve) => {
      setPendingUserQuestion({ request, resolve });
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
      if (event.type === 'mode_changed') {
        setInputMode(event.mode.inputMode);
        setOperatingMode(event.mode.operatingMode);
        setCurrentApprovalMode(event.mode.permissionMode);
      }
      if (event.type === 'model_request') setStatus('thinking');
      if (event.type === 'approval_requested') setStatus('awaiting_approval');
      if (event.type === 'tool_started') setStatus('executing_tool');
      if (event.type === 'validation_started') setStatus('verifying');
      if (event.type === 'message_queued') setQueuedCount(event.queueLength);
      if (event.type === 'message_queued_consumed') setQueuedCount(event.remaining);
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
      mode: initialMode,
      maxTurns,
      eventBus: events,
      mcpManager,
      signal: controller.signal,
      permissionManager: permissionsRef.current,
      skillsDirs,
      additionalRoots,
      projectConfig,
      agent,
    });
    setInputMode(runtime.getMode().inputMode);
    setOperatingMode(runtime.getMode().operatingMode);
    setCurrentApprovalMode(runtime.getMode().permissionMode);
    runtimeRef.current = runtime;

    // Broken skills must be visible during normal use, not only via
    // doctor/skills (VC-KIMI-043). Surface a single consolidated warning.
    const skillErrors = runtime.getSkillErrors();
    if (skillErrors.length > 0) {
      setMessages((prev) => [
        ...prev,
        {
          id: 'skills-warning',
          role: 'event',
          content: `⚠ ${skillErrors.length} skill discovery error${skillErrors.length === 1 ? '' : 's'}:\n${skillErrors.map((e) => `  • ${e}`).join('\n')}`,
        },
      ]);
    }

    if (resumeSessionId) {
      const stored = new SessionManager().load(resumeSessionId, workspaceRoot);
      if (stored) {
        // loadState emits an authoritative mode_changed event, which the
        // listener above applies to input/operating/approval mode state
        // (VC-KIMI-025).
        runtime.loadState(stored.state);
        setCurrentModel(stored.state.model);
        setCurrentModelProfile(stored.state.modelProfile);
        setStatus(stored.state.status);
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
            id: `resume-${resumeSessionId}`,
            role: 'event',
            content: `Resumed session ${resumeSessionId} · ${stored.state.messages.length} messages restored`,
          },
        ]);
      } else {
        addEvent(`Session not found in this workspace: ${resumeSessionId}`);
      }
    }

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
      setPendingPlanApproval((current) => {
        if (current) {
          current.resolve(false);
        }
        return null;
      });
      setPendingUserQuestion((current) => {
        if (current) {
          current.resolve(undefined);
        }
        return null;
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceRoot, model, approvalMode, maxTurns, mcpManager, skillsDirs, additionalRoots, projectConfig, agent]);

  const addEvent = (content: string) => {
    setMessages((prev) => [...prev, { id: String(prev.length + 1), role: 'event', content }]);
  };

  const handleShellPassthrough = async (command: string) => {
    addEvent(`$ ${command}`);
    const runtime = runtimeRef.current;
    if (!runtime) {
      addEvent('Shell unavailable.');
      return;
    }
    // Direct shell must go through the runtime so it uses the same risk
    // classification, permission policy, approval prompts, event stream,
    // session trace, and cancellation as agent tool calls (VC-KIMI-008).
    try {
      const result = await runtime.executeDirectTool('shell', { command }, { source: 'shell-mode' });
      if (!result.approved) {
        addEvent('Shell command denied.');
        return;
      }
      if (result.ok) {
        const output = result.data as { stdout?: string; stderr?: string; exitCode?: number | null };
        addEvent(`exit ${output.exitCode ?? '?'}`);
        if (output.stdout) addEvent(output.stdout);
        if (output.stderr) addEvent(output.stderr);
      } else {
        addEvent(`Error: ${result.error?.message || 'shell failed'}`);
      }
    } catch (err) {
      addEvent(String(err));
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
    // loadState emits an authoritative mode_changed event, which restores
    // input/operating/approval mode UI state (VC-KIMI-025).
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

  const submitToModel = async (rawText: string) => {
    const { text: resolvedText, mentions } = resolveMentions(rawText);

    if (isRunning) {
      // Queue instead of rejecting (VC-KIMI-053): Enter while busy appends
      // the next user message, which runs after the current turn completes.
      setMessages((prev) => [...prev, { id: String(prev.length + 1), role: 'user', content: resolvedText }]);
      runtimeRef.current?.queueUserMessage(resolvedText);
      return;
    }

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

  const handleInject = (rawText: string): boolean => {
    const trimmed = rawText.trim();
    if (!trimmed || !isRunning) return false;
    // Inject into the current turn after the next tool boundary (VC-KIMI-053).
    const { text } = resolveMentions(trimmed);
    setMessages((prev) => [...prev, { id: String(prev.length + 1), role: 'user', content: `↳ ${text}` }]);
    runtimeRef.current?.injectUserMessage(text);
    return true;
  };

  const handleSubmit = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // The greeting is orientation for a new session; the first real user
    // input dismisses it cleanly (it never enters transcript/session state).
    setGreetingVisible(false);

    const slash = parseSlashCommand(trimmed);
    if (slash) {
      const handled = await handleSlashCommand(slash.command, slash.args, {
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
        showModelPicker: () => setPickerMode('model-picker'),
        showSessionPicker: () => setPickerMode('session-picker'),
        resumeSession: handleResumeSession,
        listSessions: () => new SessionManager().list(workspaceRoot),
        mcpManager,
        getRuntime: () => runtimeRef.current ?? undefined,
      });
      if (!handled) {
        // Unknown /foo is sent to the model verbatim rather than rejected
        // (VC-KIMI-047).
        await submitToModel(trimmed);
      }
      return;
    }

    if (inputMode === 'shell') {
      handleShellPassthrough(trimmed).catch((err) => addEvent(String(err)));
      return;
    }

    if (trimmed.startsWith('!')) {
      const command = trimmed.slice(1).trim();
      if (command) {
        handleShellPassthrough(command).catch((err) => addEvent(String(err)));
      }
      return;
    }

    await submitToModel(trimmed);
  };

  const handleApprovalDecision = (decision: ApprovalDecision) => {
    pendingApproval?.resolve(decision);
    setPendingApproval(null);
  };

  const handlePlanApprovalDecision = (approved: boolean) => {
    pendingPlanApproval?.resolve(approved);
    setPendingPlanApproval(null);
  };

  const { columns, rows } = useStdoutDimensions();
  // Terminal/environment state does not change during a process lifetime, so
  // this is resolved once and cached rather than re-read on every render.
  const greetingPolicy = resolveGreetingPolicy();

  const showGreeting =
    !initialObjective?.trim() &&
    !resumeSessionId &&
    greetingVisible &&
    pickerMode === 'normal';

  return (
    <Box flexDirection="column" height={rows} width={columns}>
      {showGreeting && (
        <Greeting
          columns={columns}
          rows={rows}
          model={currentModel}
          workspaceRoot={workspaceRoot}
          gitBranch={gitBranch}
          agentMode={currentModelProfile?.mode ?? runtimeRef.current?.getState().agentMode ?? 'agent'}
          inputMode={inputMode}
          operatingMode={operatingMode}
          approvalMode={currentApprovalMode}
          animate={greetingPolicy.animate}
          accentColor={greetingPolicy.accentColor}
        />
      )}
      <Transcript messages={messages} maxMessages={Math.max(3, rows - 8)} />
      {error && (
        <Box paddingX={1}>
          <Text color="red">Error: {error}</Text>
        </Box>
      )}
      {pickerMode === 'model-picker' && (
        <ModelPicker
          limit={Math.max(3, Math.min(8, rows - 12))}
          columns={columns}
          currentModel={currentModel}
          onSelect={(selected, profile) => {
            handleSetModel(selected, profile).catch(() => {});
            addEvent(profile.mode === 'chat-only'
              ? `Model set to ${selected}. Chat only — agent tools unavailable.`
              : `Model set to ${selected}. Agent tools enabled.`);
            setPickerMode('normal');
          }}
        />
      )}
      {pickerMode === 'session-picker' && (
        <SessionPicker
          limit={Math.max(3, Math.min(6, rows - 12))}
          columns={columns}
          workspaceRoot={workspaceRoot}
          onSelect={(sessionId) => {
            handleResumeSession(sessionId);
            setPickerMode('normal');
          }}
        />
      )}
      {pendingApproval && pickerMode === 'normal' && (
        <ApprovalPrompt
          toolName={pendingApproval.toolName}
          input={pendingApproval.input}
          risk={pendingApproval.risk}
          onDecision={handleApprovalDecision}
        />
      )}
      {pendingPlanApproval && pickerMode === 'normal' && (
        <PlanApprovalPrompt plan={pendingPlanApproval.plan} onDecision={handlePlanApprovalDecision} />
      )}
      {pendingUserQuestion && pickerMode === 'normal' && (
        <UserQuestionPrompt
          request={pendingUserQuestion.request}
          onSubmit={(response) => {
            pendingUserQuestion.resolve(response);
            setPendingUserQuestion(null);
          }}
        />
      )}
      <Composer
        onSubmit={handleSubmit}
        onInject={handleInject}
        workspaceRoot={workspaceRoot}
        inputMode={inputMode}
        operatingMode={operatingMode}
        disabled={pendingApproval !== null || pendingPlanApproval !== null || pendingUserQuestion !== null || pickerMode !== 'normal'}
        maxSuggestions={Math.max(3, Math.min(8, rows - 11))}
        columns={columns}
        skillNames={runtimeRef.current?.getState().skillSummaries.map((s) => s.name) ?? []}
      />
      <StatusBar
        columns={columns}
        state={{
          messages,
          status,
          model: currentModel,
          agentMode: currentModelProfile?.mode ?? runtimeRef.current?.getState().agentMode ?? 'agent',
          modelProfile: currentModelProfile ?? runtimeRef.current?.getState().modelProfile,
          inputMode,
          operatingMode,
          workspaceRoot,
          additionalRoots: runtimeRef.current?.getState().workspace.additionalRoots ?? additionalRoots ?? [],
          queuedCount,
          approvalMode: currentApprovalMode,
          contextTokens: runtimeRef.current?.getContextManager().estimateTokens() ?? 0,
          maxTokens: runtimeRef.current?.getContextManager().getMaxTokens() ?? 0,
          gitBranch,
        }}
      />
    </Box>
  );
}
