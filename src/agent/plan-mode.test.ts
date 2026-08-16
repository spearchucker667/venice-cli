import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AgentRuntime } from './runtime.js';
import { defaultMode } from './mode.js';

describe('plan mode', () => {
  it('filters write tools from model definitions', () => {
    const runtime = new AgentRuntime({
      workspaceRoot: process.cwd(),
      objective: 'plan test',
      mode: { ...defaultMode(), operatingMode: 'plan' },
    });
    const defs = runtime.getToolDefinitions();
    const names = defs.map((d) => d.function.name);
    assert.ok(!names.includes('write_file'), 'write_file should be excluded');
    assert.ok(!names.includes('shell'), 'shell should be excluded');
    assert.ok(!names.includes('spawn_agent'), 'spawn_agent should be excluded');
    assert.ok(names.includes('read_file'), 'read_file should be included');
    assert.ok(names.includes('glob'), 'glob should be included');
  });

  it('can toggle plan mode at runtime', () => {
    const runtime = new AgentRuntime({
      workspaceRoot: process.cwd(),
      objective: 'plan test',
    });
    assert.strictEqual(runtime.getMode().operatingMode, 'agent');
    runtime.setMode({ operatingMode: 'plan' });
    assert.strictEqual(runtime.getMode().operatingMode, 'plan');
    assert.ok(!runtime.getToolDefinitions().some((d) => d.function.name === 'shell'));
  });
});
