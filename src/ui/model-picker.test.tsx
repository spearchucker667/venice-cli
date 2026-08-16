import { describe, it } from 'node:test';
import assert from 'node:assert';
import { render } from 'ink-testing-library';
import { buildModelItems, ModelPicker } from './model-picker.js';
import type { Model } from '../types/index.js';

describe('ModelPicker', () => {
  it('renders loading state', () => {
    const { lastFrame } = render(<ModelPicker currentModel="kimi-k2.5" onSelect={() => {}} />);
    const frame = lastFrame() || '';
    assert.ok(frame.includes('Loading models'));
  });

  it('labels models without function calling as chat-only and preserves their profile', () => {
    const models: Model[] = [
      { id: 'chat-model', type: 'text', model_spec: { privacy: 'private', capabilities: { supportsFunctionCalling: false, supportsE2EE: true } } },
      { id: 'agent-model', type: 'text', model_spec: { availableContextTokens: 128000, capabilities: { supportsFunctionCalling: true } } },
    ];
    const { lastFrame } = render(
      <ModelPicker
        currentModel="agent-model"
        availableModels={models}
        onSelect={() => {}}
      />
    );
    const frame = lastFrame() || '';
    assert.match(frame, /agent-model.*tools.*128K ctx/);
    assert.match(frame, /chat-model.*chat only.*E2EE/);
    assert.equal(buildModelItems(models, 'agent-model')[0].value.mode, 'chat-only');
  });
});
