import { describe, it } from 'node:test';
import assert from 'node:assert';
import { handleSlashCommand, SLASH_HANDLERS } from './slash-handlers.js';
import { SLASH_COMMANDS, getSlashCommandBase } from './slash-commands.js';
import type { TuiMessage } from './types.js';
import type { AgentRuntime } from '../agent/runtime.js';

describe('handleSlashCommand', () => {
  const makeContext = () => {
    let exited = false;
    let model = 'kimi-k2.5';
    let pickerShown: 'model' | 'session' | undefined = undefined;
    let resumedSessionId: string | undefined = undefined;
    let themeRefreshed = false;
    const deleted: string[] = [];
    const messages: TuiMessage[] = [];
    return {
      exited: () => exited,
      messages: () => messages,
      currentModel: () => model,
      pickerShown: () => pickerShown,
      resumedSessionId: () => resumedSessionId,
      themeRefreshed: () => themeRefreshed,
      deleted: () => deleted,
      context: {
        exit: () => { exited = true; },
        refreshTheme: () => { themeRefreshed = true; },
        setMessages: (updater: (prev: TuiMessage[]) => TuiMessage[]) => {
          const next = updater(messages);
          messages.length = 0;
          messages.push(...next);
        },
        status: 'idle' as const,
        model,
        approvalMode: 'auto-edit',
        workspaceRoot: '/tmp',
        setModel: (next: string) => { model = next; },
        showModelPicker: () => { pickerShown = 'model'; },
        showSessionPicker: () => { pickerShown = 'session'; },
        resumeSession: async (id: string) => { resumedSessionId = id; },
        listSessions: () => [],
        deleteSession: (id: string) => { deleted.push(id); return true; },
        getRuntime: (): AgentRuntime | undefined => undefined,
      },
    };
  };

  it('handles /help', async () => {
    const { context, messages } = makeContext();
    await handleSlashCommand('help', '', context);
    assert.ok(messages().some((m) => m.content.includes('Just tell Venice what you want done')));
  });

  it('handles /quit', async () => {
    const { context, exited } = makeContext();
    await handleSlashCommand('quit', '', context);
    assert.strictEqual(exited(), true);
  });

  it('handles /clear as a fresh session (VC-KIMI-023)', async () => {
    const { context, messages } = makeContext();
    messages().push({ id: '1', role: 'user', content: 'hello' });
    await handleSlashCommand('clear', '', context);
    assert.strictEqual(messages().filter((m) => m.role === 'user').length, 0, 'user transcript cleared');
    assert.ok(messages().some((m) => m.content.includes('fresh session')), 'confirms the fresh session');
  });

  it('handles /clear-ui as transcript-only', async () => {
    const { context, messages } = makeContext();
    messages().push({ id: '1', role: 'user', content: 'hello' });
    await handleSlashCommand('clear-ui', '', context);
    assert.strictEqual(messages().filter((m) => m.role === 'user').length, 0);
    assert.ok(messages().some((m) => m.content.includes('UI only')), 'labels the transcript-only behavior');
  });

  it('handles /status', async () => {
    const { context, messages } = makeContext();
    await handleSlashCommand('status', '', context);
    assert.ok(messages().some((m) => m.content.includes('kimi-k2.5')));
    assert.ok(messages().some((m) => m.content.includes('/tmp')));
  });

  it('handles /model with argument', async () => {
    const { context, messages, currentModel } = makeContext();
    await handleSlashCommand('model', 'gpt-4o', context);
    assert.strictEqual(currentModel(), 'gpt-4o');
    assert.ok(messages().some((m) => m.content.includes('Model set to gpt-4o')));
  });

  it('handles /model without argument by opening picker', async () => {
    const { context, pickerShown } = makeContext();
    await handleSlashCommand('model', '', context);
    assert.strictEqual(pickerShown(), 'model');
  });

  it('handles /models by opening picker', async () => {
    const { context, pickerShown } = makeContext();
    await handleSlashCommand('models', '', context);
    assert.strictEqual(pickerShown(), 'model');
  });

  it('handles /resume with argument', async () => {
    const { context, resumedSessionId } = makeContext();
    await handleSlashCommand('resume', 'session-123', context);
    assert.strictEqual(resumedSessionId(), 'session-123');
  });

  it('handles /resume without argument by opening picker', async () => {
    const { context, pickerShown } = makeContext();
    await handleSlashCommand('resume', '', context);
    assert.strictEqual(pickerShown(), 'session');
  });

  it('handles /sessions when no sessions exist', async () => {
    const { context, messages } = makeContext();
    await handleSlashCommand('sessions', '', context);
    assert.ok(messages().some((m) => m.content.includes('No saved sessions')));
  });

  it('handles /delete with no argument by showing usage', async () => {
    const { context, messages, deleted } = makeContext();
    await handleSlashCommand('delete', '', context);
    assert.ok(messages().some((m) => m.content.includes('Usage: /delete')));
    assert.strictEqual(deleted().length, 0);
  });

  it('handles /delete by deleting a saved session (P2)', async () => {
    const { context, messages, deleted } = makeContext();
    await handleSlashCommand('delete', 'session-abc', context);
    assert.deepStrictEqual(deleted(), ['session-abc']);
    assert.ok(messages().some((m) => m.content.includes('Deleted session session-abc')));
  });

  it('refuses to /delete the active session (P2)', async () => {
    const { context, messages, deleted } = makeContext();
    context.getRuntime = () => ({ getState: () => ({ sessionId: 'session-live' }) }) as unknown as AgentRuntime;
    await handleSlashCommand('delete', 'session-live', context);
    assert.strictEqual(deleted().length, 0);
    assert.ok(messages().some((m) => m.content.includes('Refusing to delete the active session')));
  });

  it('handles /theme without argument (no config write, no refresh)', async () => {
    const { context, messages, themeRefreshed } = makeContext();
    await handleSlashCommand('theme', '', context);
    assert.ok(messages().some((m) => m.content.includes('Current theme:')));
    assert.strictEqual(themeRefreshed(), false);
  });

  it('rejects an invalid /theme without refreshing (P2)', async () => {
    const { context, messages, themeRefreshed } = makeContext();
    await handleSlashCommand('theme', 'not-a-theme', context);
    assert.ok(messages().some((m) => m.content.includes('Invalid theme')));
    assert.strictEqual(themeRefreshed(), false);
  });

  it('handles /diff and /review', async () => {
    const { context, messages } = makeContext();
    await handleSlashCommand('diff', '', context);
    assert.ok(messages().length > 0);

    await handleSlashCommand('review', '', context);
    assert.ok(messages().some((m) => m.content.includes('No active session state') || m.content.includes('Session Review')));
  });

  it('handles /plan, /compact, /tools, /mcp, /skills, /permissions', async () => {
    const { context, messages } = makeContext();
    await handleSlashCommand('plan', '', context);
    assert.ok(messages().some((m) => m.content.includes('No active plan') || m.content.includes('Current Plan')));

    await handleSlashCommand('compact', '', context);
    assert.ok(messages().some((m) => m.content.includes('Context compact') || m.content.includes('No active runtime')));

    await handleSlashCommand('tools', '', context);
    assert.ok(messages().some((m) => m.content.includes('Registered Tools')));

    await handleSlashCommand('mcp', '', context);
    assert.ok(messages().some((m) => m.content.includes('MCP Manager is not active') || m.content.includes('MCP Servers')));

    await handleSlashCommand('skills', '', context);
    assert.ok(messages().some((m) => m.content.includes('No active runtime') || m.content.includes('Available Skills')));

    await handleSlashCommand('permissions', '', context);
    assert.ok(messages().some((m) => m.content.includes('Approval Mode')));
  });

  it('handles /git, /init, /context, and /new', async () => {
    const { context, messages } = makeContext();
    await handleSlashCommand('git', '', context);
    assert.ok(messages().length > 0);

    await handleSlashCommand('init', '', context);
    assert.ok(messages().some((m) => m.content.includes('Venice workspace initialized') || m.content.includes('Init error')));

    await handleSlashCommand('context', '', context);
    assert.ok(messages().some((m) => m.content.includes('Context Overview')));

    await handleSlashCommand('new', '', context);
    assert.ok(messages().some((m) => m.content.includes('Started fresh conversation context')));
  });

  it('keeps slash metadata and handlers in sync (VC-KIMI-048)', () => {
    const handlerKeys = new Set(Object.keys(SLASH_HANDLERS));
    const metadataBases = new Set(SLASH_COMMANDS.map((c) => getSlashCommandBase(c.name)));
    for (const cmd of SLASH_COMMANDS) {
      assert.ok(handlerKeys.has(getSlashCommandBase(cmd.name)), `metadata command /${cmd.name} has no handler`);
    }
    for (const key of handlerKeys) {
      assert.ok(metadataBases.has(key), `handler /${key} is missing from metadata`);
    }
  });

  it('loads a skill via /skill <name> (VCL-R3-032)', async () => {
    const loaded: string[] = [];
    const messages: TuiMessage[] = [];
    const fakeRuntime = {
      loadSkill: (name: string) => {
        if (name === 'release') {
          loaded.push(name);
          return true;
        }
        return false;
      },
      getState: () => ({
        activeSkills: ['release'],
        skillSummaries: [{ name: 'release', description: 'Release skill', tools: [], source: 'x' }],
      }),
    };
    const context = {
      exit: () => {},
      setMessages: (updater: (prev: TuiMessage[]) => TuiMessage[]) => {
        const next = updater(messages);
        messages.length = 0;
        messages.push(...next);
      },
      status: 'idle' as const,
      model: 'kimi-k2.5',
      approvalMode: 'auto-edit',
      workspaceRoot: '/tmp',
      getRuntime: () => fakeRuntime as unknown as AgentRuntime,
    };

    await handleSlashCommand('skill', 'release', context);
    assert.deepStrictEqual(loaded, ['release']);
    assert.ok(messages.some((m) => m.content.includes("Skill 'release' loaded and active")));

    await handleSlashCommand('skill', 'nope', context);
    assert.ok(messages.some((m) => m.content.includes('Unknown skill: nope')));
  });

  it('forwards unknown commands to the model instead of intercepting them (VC-KIMI-047)', async () => {
    const { context, messages } = makeContext();
    const handled = await handleSlashCommand('frobnicate', '', context);
    // `false` signals the caller to forward the raw command to the agent.
    assert.strictEqual(handled, false);
    // The non-blocking hint is still shown.
    assert.ok(messages().some(m => m.content.includes('Unknown command')));
  });

  it('rejects idle-only commands while the agent is running (VC-KIMI-046)', async () => {
    const { context, messages } = makeContext();
    const running = { ...context, status: 'thinking' as const };
    const handled = await handleSlashCommand('compact', '', running);
    assert.strictEqual(handled, true);
    assert.ok(messages().some((m) => m.content.includes('only available while the agent is idle')));
  });

  it('gates mutating commands on the runtime busy state even with a stale UI status (VCL-003)', async () => {
    const { context, messages } = makeContext();
    const busyRuntime = { isBusy: () => true } as unknown as AgentRuntime;
    const running = { ...context, status: 'idle' as const, getRuntime: () => busyRuntime };

    for (const name of ['model', 'new', 'resume', 'fork', 'plan', 'permissions', 'reload', 'import', 'delete', 'theme', 'skill', 'auto', 'yolo', 'effort', 'compact']) {
      const handled = await handleSlashCommand(name, '', running);
      assert.strictEqual(handled, true, `/${name} must be intercepted while the runtime is busy`);
      assert.ok(
        messages().some((m) => m.content.includes('only available while the agent is idle')),
        `/${name} must report the idle-only rejection`
      );
    }

    // Read-only commands stay available even while the runtime is busy.
    const before = messages().length;
    await handleSlashCommand('help', '', running);
    assert.ok(messages().length > before, '/help must remain available while busy');
  });

  it('passes a /compact hint to the runtime (VC-KIMI-049)', async () => {
    let captured: string | undefined;
    const { context, messages } = makeContext();
    const withRuntime = {
      ...context,
      getRuntime: () => ({ forceCompact: (hint?: string) => { captured = hint; } }) as unknown as AgentRuntime,
    };
    await handleSlashCommand('compact', 'focus on the parser', withRuntime);
    assert.strictEqual(captured, 'focus on the parser');
    assert.ok(messages().some((m) => m.content.includes('Context compacted with hint: focus on the parser')));
  });
});
