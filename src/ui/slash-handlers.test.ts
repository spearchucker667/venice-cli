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
        resumeSession: (id: string) => { resumedSessionId = id; },
        listSessions: () => [],
      },
    };
  };

  it('handles /help', () => {
    const { context, messages } = makeContext();
    handleSlashCommand('help', '', context);
    assert.ok(messages().some((m) => m.content.includes('Available slash commands')));
  });

  it('handles /quit', () => {
    const { context, exited } = makeContext();
    handleSlashCommand('quit', '', context);
    assert.strictEqual(exited(), true);
  });

  it('handles /clear', () => {
    const { context, messages } = makeContext();
    messages().push({ id: '1', role: 'user', content: 'hello' });
    handleSlashCommand('clear', '', context);
    assert.strictEqual(messages().length, 0);
  });

  it('handles /status', () => {
    const { context, messages } = makeContext();
    handleSlashCommand('status', '', context);
    assert.ok(messages().some((m) => m.content.includes('kimi-k2.5')));
    assert.ok(messages().some((m) => m.content.includes('/tmp')));
  });

  it('handles /model with argument', () => {
    const { context, messages, currentModel } = makeContext();
    handleSlashCommand('model', 'gpt-4o', context);
    assert.strictEqual(currentModel(), 'gpt-4o');
    assert.ok(messages().some((m) => m.content.includes('Model set to gpt-4o')));
  });

  it('handles /model without argument by opening picker', () => {
    const { context, pickerShown } = makeContext();
    handleSlashCommand('model', '', context);
    assert.strictEqual(pickerShown(), 'model');
  });

  it('handles /models by opening picker', () => {
    const { context, pickerShown } = makeContext();
    handleSlashCommand('models', '', context);
    assert.strictEqual(pickerShown(), 'model');
  });

  it('handles /resume with argument', () => {
    const { context, resumedSessionId } = makeContext();
    handleSlashCommand('resume', 'session-123', context);
    assert.strictEqual(resumedSessionId(), 'session-123');
  });

  it('handles /resume without argument by opening picker', () => {
    const { context, pickerShown } = makeContext();
    handleSlashCommand('resume', '', context);
    assert.strictEqual(pickerShown(), 'session');
  });

  it('handles /sessions when no sessions exist', () => {
    const { context, messages } = makeContext();
    handleSlashCommand('sessions', '', context);
    assert.ok(messages().some((m) => m.content.includes('No saved sessions')));
  });
});
