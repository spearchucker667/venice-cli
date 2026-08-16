import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ToolRegistry, createDefaultRegistry } from './registry.js';
import type { AgentTool } from './types.js';

const echoTool: AgentTool<{ text: string }, string> = {
  name: 'echo',
  description: 'Echo text',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  risk: 'read',
  async execute(input) {
    return { ok: true, data: input.text };
  },
};

describe('ToolRegistry', () => {
  it('registers and looks up tools', () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    assert.strictEqual(registry.get('echo'), echoTool);
  });

  it('rejects duplicate registrations', () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    assert.throws(() => registry.register(echoTool), /already registered/);
  });

  it('returns Venice-compatible definitions', () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    const defs = registry.definitions();
    assert.strictEqual(defs.length, 1);
    assert.strictEqual(defs[0].function.name, 'echo');
  });

  it('default registry includes spawn_agent', () => {
    const registry = createDefaultRegistry();
    assert.ok(registry.has('spawn_agent'));
  });

  it('default registry includes Venice media tools', () => {
    const registry = createDefaultRegistry();
    for (const name of [
      'edit_image',
      'upscale_image',
      'remove_background',
      'generate_video',
      'image_to_video',
      'transcribe_audio',
      'text_to_speech',
    ]) {
      assert.ok(registry.has(name), `missing ${name}`);
    }
  });

  it('plan mode excludes write, shell, and media tools', () => {
    const registry = createDefaultRegistry();
    const planDefs = registry.definitions('plan').map((d) => d.function.name);
    for (const name of ['write_file', 'edit_file', 'apply_patch', 'shell', 'spawn_agent', 'run_validation', 'todo_write', 'generate_image', 'generate_video', 'generate_music']) {
      assert.ok(!planDefs.includes(name), `plan mode should exclude ${name}`);
    }
    assert.ok(planDefs.includes('read_file'));
    assert.ok(planDefs.includes('glob'));
    assert.ok(planDefs.includes('git_status'));
  });
});
