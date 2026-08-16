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
    assert.ok((lastFrame() || '').includes('read_file'));
  });
});
