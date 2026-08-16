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
    assert.ok(frame.includes('Reading package.json'));
    assert.ok(frame.includes('complete'));
  });

  it('folds verbose shell output into a test summary', () => {
    const { lastFrame } = render(
      <ToolCallEvent
        toolName="shell"
        input={{ command: 'npm test' }}
        ok={true}
        result={{ ok: true, data: { exitCode: 0, stdout: '# pass 391\n# fail 0\n'.repeat(100), stderr: '' } }}
      />
    );
    const frame = lastFrame() || '';
    assert.match(frame, /Running npm test/);
    assert.match(frame, /391 passed · 0 failed/);
    assert.doesNotMatch(frame, /# pass/);
  });

  it('renders a failed tool call', () => {
    const { lastFrame } = render(
      <ToolCallEvent toolName="shell" input={{ command: 'false' }} ok={false} error="exit 1" />
    );
    const frame = lastFrame() || '';
    assert.ok(frame.includes('Running false'));
    assert.ok(frame.includes('exit 1'));
  });

  it('renders a non-zero shell result as a folded failure with error context', () => {
    const { lastFrame } = render(
      <ToolCallEvent toolName="shell" input={{ command: 'npm test' }} ok={true}
        result={{ ok: true, data: { exitCode: 1, stdout: '', stderr: 'AssertionError: expected 1 to equal 2\nstack detail' } }} />
    );
    const frame = lastFrame() || '';
    assert.match(frame, /✗ Running npm test · exit 1/);
    assert.match(frame, /AssertionError/);
  });
});
