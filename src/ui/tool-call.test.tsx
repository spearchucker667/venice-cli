import { describe, it } from 'node:test';
import assert from 'node:assert';
import { render } from 'ink-testing-library';
import { ToolCallEvent } from './tool-call.js';

describe('ToolCallEvent', () => {
  it('renders a successful tool call', () => {
    const { lastFrame } = render(
      <ToolCallEvent toolName="read_file" input={{ path: 'package.json' }} ok={true} />
    );
    const frame = lastFrame() || '';
    assert.ok(frame.includes('read_file'));
    assert.ok(frame.includes('done'));
  });

  it('renders a failed tool call', () => {
    const { lastFrame } = render(
      <ToolCallEvent toolName="shell" input={{ command: 'false' }} ok={false} error="exit 1" />
    );
    const frame = lastFrame() || '';
    assert.ok(frame.includes('shell'));
    assert.ok(frame.includes('exit 1'));
  });
});
