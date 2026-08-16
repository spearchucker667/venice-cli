import { describe, it } from 'node:test';
import assert from 'node:assert';
import { render } from 'ink-testing-library';
import { Composer } from './composer.js';

describe('Composer', () => {
  it('renders an input prompt', () => {
    const { lastFrame } = render(<Composer onSubmit={() => {}} />);
    assert.ok(lastFrame()?.includes('>'));
  });

  it('submits trimmed text', () => {
    const { stdin, lastFrame } = render(<Composer onSubmit={(text) => {
      assert.strictEqual(text, 'hello');
    }} />);
    stdin.write('hello');
    stdin.write('\r');
    assert.ok(lastFrame()?.includes('hello'));
  });
});
