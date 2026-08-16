import { describe, it } from 'node:test';
import assert from 'node:assert';
import { render } from 'ink-testing-library';
import { Composer } from './composer.js';

describe('Shell mode composer', () => {
  it('renders $ prompt in shell mode', () => {
    const { lastFrame } = render(
      <Composer onSubmit={() => {}} workspaceRoot="/tmp" inputMode="shell" />
    );
    const frame = lastFrame() || '';
    assert.ok(frame.startsWith('$'), `expected $ prompt, got: ${frame}`);
  });

  it('renders P prompt in plan mode', () => {
    const { lastFrame } = render(
      <Composer onSubmit={() => {}} workspaceRoot="/tmp" operatingMode="plan" />
    );
    const frame = lastFrame() || '';
    assert.ok(frame.startsWith('P'), `expected P prompt, got: ${frame}`);
  });

  it('renders > prompt in agent mode', () => {
    const { lastFrame } = render(
      <Composer onSubmit={() => {}} workspaceRoot="/tmp" />
    );
    const frame = lastFrame() || '';
    assert.ok(frame.startsWith('>'), `expected > prompt, got: ${frame}`);
  });
});
