import { describe, it } from 'node:test';
import assert from 'node:assert';
import { render } from 'ink-testing-library';
import { Composer } from './composer.js';

describe('Composer slash picker', () => {
  it('renders the composer prompt', () => {
    const { lastFrame } = render(<Composer workspaceRoot={process.cwd()} onSubmit={() => {}} />);
    assert.ok(lastFrame()?.includes('>'));
  });

  it('shows slash-command suggestions and accepts one with Tab', async () => {
    const { stdin, lastFrame } = render(<Composer workspaceRoot={process.cwd()} onSubmit={() => {}} />);
    stdin.write('/');
    await new Promise(r => setTimeout(r, 50));
    let frame = lastFrame() ?? '';
    assert.ok(frame.includes('Commands'), `expected Commands header, got: ${frame}`);
    assert.ok(frame.includes('/help'), `expected /help suggestion, got: ${frame}`);

    stdin.write('he');
    await new Promise(r => setTimeout(r, 50));
    stdin.write('\t');
    await new Promise(r => setTimeout(r, 50));
    frame = lastFrame() ?? '';
    assert.ok(frame.includes('/help'), `expected /help autocomplete, got: ${frame}`);
    assert.ok(!frame.includes('Commands'), `expected picker to close, got: ${frame}`);
  });
});
