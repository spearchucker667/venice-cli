import { describe, it } from 'node:test';
import assert from 'node:assert';
import { render } from 'ink-testing-library';
import { Transcript } from './transcript.js';

describe('Transcript', () => {
  it('renders user and assistant messages', () => {
    const messages = [
      { id: '1', role: 'user' as const, content: 'hello' },
      { id: '2', role: 'assistant' as const, content: 'hi there' },
    ];
    const { lastFrame } = render(<Transcript messages={messages} />);
    const frame = lastFrame() || '';
    assert.ok(frame.includes('hello'));
    assert.ok(frame.includes('hi there'));
  });

  it('renders tool events', () => {
    const messages = [
      {
        id: '1',
        role: 'tool' as const,
        content: 'done',
        metadata: { toolName: 'read_file', input: { path: 'package.json' }, ok: true },
      },
    ];
    const { lastFrame } = render(<Transcript messages={messages} />);
    assert.ok((lastFrame() || '').includes('Reading package.json'));
  });

  it('bounds visible history for small terminals', () => {
    const messages = Array.from({ length: 12 }, (_, index) => ({
      id: String(index), role: 'event' as const, content: `event-${index}`,
    }));
    const { lastFrame } = render(<Transcript messages={messages} maxMessages={3} />);
    const frame = lastFrame() || '';
    assert.match(frame, /9 earlier entries hidden/);
    assert.doesNotMatch(frame, /event-8/);
    assert.match(frame, /event-9/);
    assert.match(frame, /event-11/);
  });
});
