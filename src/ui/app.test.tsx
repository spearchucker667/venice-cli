import { describe, it } from 'node:test';
import assert from 'node:assert';
import { render } from 'ink-testing-library';
import { App } from './app.js';

describe('App', () => {
  it('renders the welcome message and composer', () => {
    const { lastFrame } = render(
      <App
        workspaceRoot="/tmp"
        model="kimi-k2.5"
        approvalMode="auto-edit"
        maxTurns={5}
        onExit={() => {}}
      />
    );
    const frame = lastFrame() || '';
    assert.ok(frame.includes('Venice Agent'));
    assert.ok(frame.includes('>'));
  });
});
