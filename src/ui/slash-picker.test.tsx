import { describe, it } from 'node:test';
import assert from 'node:assert';
import { render } from 'ink-testing-library';
import { Composer } from './composer.js';

/**
 * Ink's `useInput` handler mounts and re-subscribes asynchronously, and the
 * composer's controlled `TextInput` needs a beat to settle after each value
 * change. Fixed sleeps are therefore the reliable primitive here; a
 * condition-based poll returns too early and races the next keystroke, which
 * drops or overwrites input. The delays are generous enough to survive
 * parallel test load.
 */
const settle = (ms = 120): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('Composer slash picker', () => {
  it('renders the composer prompt', () => {
    const { lastFrame } = render(<Composer workspaceRoot={process.cwd()} onSubmit={() => {}} />);
    assert.ok(lastFrame()?.includes('>'));
  });

  it('shows slash-command suggestions and accepts one with Tab', async () => {
    const { stdin, lastFrame } = render(<Composer workspaceRoot={process.cwd()} onSubmit={() => {}} />);
    // Let the composer mount its input handler before typing: the leading `/`
    // can otherwise be dropped during the first frame (VCL-R3-032 note).
    await settle();
    stdin.write('/');
    await settle();
    let frame = lastFrame() ?? '';
    assert.ok(frame.includes('Commands'), `expected Commands header, got: ${frame}`);
    assert.ok(frame.includes('/help'), `expected /help suggestion, got: ${frame}`);

    stdin.write('he');
    await settle();
    stdin.write('\t');
    await settle();
    frame = lastFrame() ?? '';
    assert.ok(frame.includes('/help'), `expected /help autocomplete, got: ${frame}`);
    assert.ok(!frame.includes('Commands'), `expected picker to close, got: ${frame}`);
  });
});
