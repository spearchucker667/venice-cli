import { describe, it } from 'node:test';
import assert from 'node:assert';
import { handleSlashCommand } from './slash-handlers.js';
import type { TuiMessage } from './types.js';

describe('handleSlashCommand', () => {
  const makeContext = () => {
    let exited = false;
    let model = 'kimi-k2.5';
    let pickerShown: 'model' | 'session' | undefined = undefined;
    let resumedSessionId: string | undefined = undefined;
    const messages: TuiMessage[] = [];
    return {
      exited: () => exited,
      messages: () => messages,
      currentModel: () => model,
      pickerShown: () => pickerShown,
      resumedSessionId: () => resumedSessionId,
      context: {
        exit: () => { exited = true; },
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
      },
    };
  };

  it('handles /help', async () => {
    const { context, messages } = makeContext();
    await handleSlashCommand('help', '', context);
    assert.ok(messages().some((m) => m.content.includes('Available slash commands')));
  });

  it('handles /quit', async () => {
    const { context, exited } = makeContext();
    await handleSlashCommand('quit', '', context);
    assert.strictEqual(exited(), true);
  });

  it('handles /clear', async () => {
    const { context, messages } = makeContext();
    messages().push({ id: '1', role: 'user', content: 'hello' });
    await handleSlashCommand('clear', '', context);
    assert.strictEqual(messages().length, 0);
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
});
