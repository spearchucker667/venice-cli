import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { render } from 'ink-testing-library';
import { App } from './app.js';

describe('App', () => {
  it('renders the welcome message and composer', async () => {
    const onExit = mock.fn();
    const { lastFrame } = render(
      <App
        workspaceRoot="/test"
        model="test-model"
        approvalMode="suggest"
        maxTurns={10}
        onExit={onExit}
      />
    );

    // Give React time to render
    await new Promise((r) => setTimeout(r, 50));

    const frame = lastFrame();
    assert.ok(frame !== undefined, 'Frame should be rendered');
    assert.ok(frame.includes('>'), 'Should render composer prompt');
  });
});
