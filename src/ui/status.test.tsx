import { describe, it } from 'node:test';
import assert from 'node:assert';
import { render } from 'ink-testing-library';
import { StatusBar } from './status.js';

describe('StatusBar', () => {
  it('renders model, workspace, and context usage', () => {
    const { lastFrame } = render(
      <StatusBar
        state={{
          messages: [],
          status: 'idle',
          model: 'kimi-k2.5',
          workspaceRoot: '/tmp',
          approvalMode: 'auto-edit',
          contextTokens: 100,
          maxTokens: 128000,
        }}
      />
    );
    const frame = lastFrame() || '';
    assert.ok(frame.includes('kimi-k2.5'));
    assert.ok(frame.includes('/tmp'));
    assert.ok(frame.includes('auto-edit'));
  });
});
