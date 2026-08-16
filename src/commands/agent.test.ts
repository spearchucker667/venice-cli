import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Command } from 'commander';
import { registerAgentCommand } from './agent.js';

describe('registerAgentCommand', () => {
  it('registers the agent command', () => {
    const program = new Command();
    registerAgentCommand(program);
    const agentCmd = program.commands.find((c) => c.name() === 'agent');
    assert.ok(agentCmd);
  });

  it('registers --no-interactive and --interactive flags', () => {
    const program = new Command();
    registerAgentCommand(program);
    const agentCmd = program.commands.find((c) => c.name() === 'agent');
    assert.ok(agentCmd?.options.some((o) => o.long === '--interactive'));
    assert.ok(agentCmd?.options.some((o) => o.long === '--no-interactive'));
  });
});
