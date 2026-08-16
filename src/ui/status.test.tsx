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
          agentMode: 'agent',
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

  it('shows chat-only mode and shortens long non-Git paths', () => {
    const { lastFrame } = render(
      <StatusBar state={{
        messages: [], status: 'idle', model: 'e2ee-model', agentMode: 'chat-only',
        workspaceRoot: '/very/long/workspace/path/to/project', approvalMode: 'suggest',
        contextTokens: 1000, maxTokens: 32000,
      }} />
    );
    const frame = lastFrame() || '';
    assert.match(frame, /chat-only/);
    assert.match(frame, /…\/project/);
    assert.doesNotMatch(frame, /very\/long\/workspace/);
  });

  it('prioritizes mode, permissions, status, and utilization at narrow widths', () => {
    const { lastFrame } = render(
      <StatusBar columns={50} state={{
        messages: [], status: 'thinking', model: 'a-very-long-model-identifier', agentMode: 'chat-only',
        workspaceRoot: '/a/very/long/path/that/must/not/dominate', approvalMode: 'suggest',
        contextTokens: 16000, maxTokens: 32000,
      }} />
    );
    const frame = lastFrame() || '';
    assert.match(frame, /chat-only/);
    assert.match(frame, /suggest/);
    assert.match(frame, /thinking/);
    assert.match(frame, /50%/);
    assert.doesNotMatch(frame, /workspace|dominate/);
  });

  it('shows plan and shell mode indicators', () => {
    const { lastFrame } = render(
      <StatusBar state={{
        messages: [], status: 'idle', model: 'kimi-k2.5', agentMode: 'agent',
        operatingMode: 'plan', inputMode: 'shell',
        workspaceRoot: '/tmp', approvalMode: 'suggest',
        contextTokens: 0, maxTokens: 0,
      }} />
    );
    const frame = lastFrame() || '';
    assert.match(frame, /plan/);
    assert.match(frame, /shell/);
  });
});
