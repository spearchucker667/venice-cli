import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { render } from 'ink-testing-library';
import { App } from './app.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

describe('App', () => {
  it('renders the welcome message and composer', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'venice-app-'));
    const onExit = mock.fn();
    const previous = process.env.VENICE_NO_ANIMATION;
    process.env.VENICE_NO_ANIMATION = '1';
    try {
      const { lastFrame, unmount } = render(
        <App
          workspaceRoot={workspaceRoot}
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
      assert.ok(frame.includes('Venice CLI'), 'Should render the greeting header');
      assert.ok(frame.includes('Private and uncensored AI.'), 'Should render the brand slogan');
      assert.ok(frame.includes('test-model'), 'Should render the active model');
      assert.ok(frame.includes('>'), 'Should render composer prompt');
      unmount();
    } finally {
      if (previous === undefined) delete process.env.VENICE_NO_ANIMATION;
      else process.env.VENICE_NO_ANIMATION = previous;
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
