import { describe, it } from 'node:test';
import assert from 'node:assert';
import { render } from 'ink-testing-library';
import { ApprovalPrompt } from './approval.js';

describe('ApprovalPrompt', () => {
  it('renders the tool name and risk', () => {
    const { lastFrame } = render(
      <ApprovalPrompt toolName="shell" input={{ command: 'echo hi' }} risk="execute" onDecision={() => {}} />
    );
    const frame = lastFrame() || '';
    assert.ok(frame.includes('shell'));
    assert.ok(frame.includes('execute'));
  });
});
