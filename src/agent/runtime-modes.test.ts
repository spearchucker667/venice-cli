import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AgentRuntime } from './runtime.js';
import { defaultMode } from './mode.js';
import { EventBus } from './events.js';

describe('runtime modes', () => {
  it('defaults to agent input and operating mode', () => {
    const runtime = new AgentRuntime({ workspaceRoot: process.cwd(), objective: 'test' });
    assert.strictEqual(runtime.getMode().inputMode, 'agent');
    assert.strictEqual(runtime.getMode().operatingMode, 'agent');
    assert.strictEqual(runtime.getMode().permissionMode, 'suggest');
  });

  it('uses provided mode', () => {
    const runtime = new AgentRuntime({
      workspaceRoot: process.cwd(),
      objective: 'test',
      mode: { ...defaultMode(), operatingMode: 'plan' },
    });
    assert.strictEqual(runtime.getMode().operatingMode, 'plan');
  });

  it('plan mode hides write tools from definitions', () => {
    const runtime = new AgentRuntime({
      workspaceRoot: process.cwd(),
      objective: 'test',
      mode: defaultMode(),
    });
    runtime.setMode({ operatingMode: 'plan' });
    const defs = runtime.getToolDefinitions();
    const names = defs.map((d) => d.function.name);
    assert.ok(!names.includes('write_file'));
    assert.ok(!names.includes('shell'));
    assert.ok(names.includes('read_file'));
    assert.ok(names.includes('glob'));
  });

  it('setMode emits mode_changed event', () => {
    const events = new EventBus();
    const runtime = new AgentRuntime({
      workspaceRoot: process.cwd(),
      objective: 'test',
      eventBus: events,
    });
    let captured: typeof events.events = [];
    events.on((event) => {
      if (event.type === 'mode_changed') captured.push(event);
    });
    runtime.setMode({ operatingMode: 'plan' });
    assert.strictEqual(captured.length, 1);
    assert.strictEqual(captured[0]?.type, 'mode_changed');
    assert.strictEqual((captured[0] as { mode: { operatingMode: string } }).mode.operatingMode, 'plan');
  });
});
