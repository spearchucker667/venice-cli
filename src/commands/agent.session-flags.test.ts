import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Command } from 'commander';
import { registerAgentCommand } from './agent.js';

describe('registerAgentCommand session flags', () => {
  it('registers --continue and --session flags', () => {
    const program = new Command();
    registerAgentCommand(program);
    const agent = program.commands.find((c) => c.name() === 'agent');
    assert.ok(agent);
    const options = agent!.options.map((o) => o.long);
    assert.ok(options.includes('--continue'));
    assert.ok(options.includes('--session'));
  });

  it('parses --session with an id as a string', () => {
    const program = new Command();
    registerAgentCommand(program);
    program.exitOverride();

    let capturedOptions: Record<string, unknown> | undefined;
    const agent = program.commands.find((c) => c.name() === 'agent');
    assert.ok(agent);
    agent!.action((options) => { capturedOptions = options; });

    program.parse(['node', 'venice', 'agent', '--session', 'abc-123']);
    assert.strictEqual(capturedOptions?.session, 'abc-123');
  });

  it('parses bare --session as true', () => {
    const program = new Command();
    registerAgentCommand(program);
    program.exitOverride();

    let capturedOptions: Record<string, unknown> | undefined;
    const agent = program.commands.find((c) => c.name() === 'agent');
    assert.ok(agent);
    agent!.action((options) => { capturedOptions = options; });

    program.parse(['node', 'venice', 'agent', '--session']);
    assert.strictEqual(capturedOptions?.session, true);
  });
});
