import { describe, it } from 'node:test';
import assert from 'node:assert';
import { handleSlashCommand } from './slash-handlers.js';
import type { TuiMessage } from './types.js';

describe('handleSlashCommand', () => {
  const makeContext = () => {
    let exited = false;
    const messages: TuiMessage[] = [];
    return {
      exited: () => exited,
      messages: () => messages,
      context: {
        exit: () => { exited = true; },
        setMessages: (updater: (prev: TuiMessage[]) => TuiMessage[]) => {
          const next = updater(messages);
          messages.length = 0;
          messages.push(...next);
        },
        status: 'idle' as const,
        model: 'kimi-k2.5',
        approvalMode: 'auto-edit',
        workspaceRoot: '/tmp',
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
});
