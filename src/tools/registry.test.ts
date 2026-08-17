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

  it('plan mode excludes write, shell, media, and checkpoint undo/redo tools', () => {
    const registry = createDefaultRegistry();
    const planDefs = registry.definitions('plan').map((d) => d.function.name);
    for (const name of ['write_file', 'edit_file', 'apply_patch', 'shell', 'spawn_agent', 'run_validation', 'todo_write', 'generate_image', 'generate_video', 'generate_music', 'checkpoint_undo', 'checkpoint_redo']) {
      assert.ok(!planDefs.includes(name), `plan mode should exclude ${name}`);
    }
    assert.ok(planDefs.includes('read_file'));
    assert.ok(planDefs.includes('glob'));
    assert.ok(planDefs.includes('git_status'));
    assert.ok(planDefs.includes('checkpoint_list'));
  });

  it('omitted planSafe is treated as unsafe in plan mode (VC-KIMI-069)', () => {
    const registry = new ToolRegistry();
    registry.register({ ...echoTool }); // no planSafe annotation
    assert.ok(registry.definitions().some((d) => d.function.name === 'echo'));
    assert.ok(!registry.definitions('plan').some((d) => d.function.name === 'echo'));
  });

  it('validates tool arguments against the advertised schema (VCL-R3-005)', () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);

    assert.deepStrictEqual(registry.validateInput('echo', { text: 'ok' }), []);
    const missing = registry.validateInput('echo', {});
    assert.ok(missing.some((m) => /missing required property "text"/.test(m)));
    const wrongType = registry.validateInput('echo', { text: 42 });
    assert.ok(wrongType.some((m) => /text/.test(m)));
  });
});
