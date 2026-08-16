import { describe, it } from 'node:test';
import assert from 'node:assert';
import { render } from 'ink-testing-library';
import { ModelPicker } from './model-picker.js';

describe('ModelPicker', () => {
  it('renders loading state', () => {
    const { lastFrame } = render(<ModelPicker currentModel="kimi-k2.5" onSelect={() => {}} />);
    const frame = lastFrame() || '';
    assert.ok(frame.includes('Loading models'));
  });
});
