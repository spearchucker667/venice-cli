import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AgentRuntime } from './runtime.js';
import { defaultMode } from './mode.js';
import { EventBus } from './events.js';
import type { RuntimeModeState } from './mode.js';

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

  it('setPermissionMode keeps the PermissionManager in lockstep (VC-KIMI-004/024)', () => {
    const runtime = new AgentRuntime({ workspaceRoot: process.cwd(), objective: 'test' });
    assert.strictEqual(runtime.getPermissionManager().getMode(), 'suggest');
    runtime.setPermissionMode('auto');
    assert.strictEqual(runtime.getMode().permissionMode, 'auto');
    assert.strictEqual(runtime.getPermissionManager().getMode(), 'auto');
  });

  it('setPermissionMode emits exactly one authoritative mode event', () => {
    const events = new EventBus();
    const runtime = new AgentRuntime({ workspaceRoot: process.cwd(), objective: 'test', eventBus: events });
    let count = 0;
    events.on((event) => {
      if (event.type === 'mode_changed') count++;
    });
    runtime.setPermissionMode('yolo');
    assert.strictEqual(count, 1);
  });

  it('loadState synchronizes the permission manager and emits mode_changed (VC-KIMI-004/025)', () => {
    const events = new EventBus();
    const runtime = new AgentRuntime({ workspaceRoot: process.cwd(), objective: 'test', eventBus: events });
    let capturedMode: RuntimeModeState | undefined;
    events.on((event) => {
      if (event.type === 'mode_changed') capturedMode = event.mode;
    });

    const live = runtime.getState();
    const stored = {
      ...live,
      sessionId: 'resumed-session',
      mode: { ...live.mode, permissionMode: 'yolo' as const, operatingMode: 'plan' as const },
    };
    runtime.loadState(stored);

    assert.strictEqual(runtime.getPermissionManager().getMode(), 'yolo');
    assert.strictEqual(runtime.getMode().permissionMode, 'yolo');
    assert.strictEqual(runtime.getMode().operatingMode, 'plan');
    assert.strictEqual(capturedMode?.permissionMode, 'yolo');
  });
});
