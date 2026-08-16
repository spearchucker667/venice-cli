import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Command } from 'commander';
import { registerAgentCommand, resolveApprovalMode } from './agent.js';

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

  it('registers --auto and --yolo shorthand flags', () => {
    const program = new Command();
    registerAgentCommand(program);
    const agentCmd = program.commands.find((c) => c.name() === 'agent');
    assert.ok(agentCmd?.options.some((o) => o.long === '--auto'));
    assert.ok(agentCmd?.options.some((o) => o.long === '--yolo'));
  });

  it('registers a repeatable --skills-dir flag', () => {
    const program = new Command();
    registerAgentCommand(program);
    program.exitOverride();
    let capturedOptions: Record<string, unknown> | undefined;
    const agent = program.commands.find((c) => c.name() === 'agent');
    assert.ok(agent);
    agent!.action((options) => { capturedOptions = options; });

    program.parse(['node', 'venice', 'agent', '--skills-dir', '/a', '--skills-dir', '/b', '-p', 'hi']);
    assert.deepStrictEqual(capturedOptions?.skillsDir, ['/a', '/b']);
  });

  it('registers a repeatable --add-dir flag', () => {
    const program = new Command();
    registerAgentCommand(program);
    program.exitOverride();
    let capturedOptions: Record<string, unknown> | undefined;
    const agent = program.commands.find((c) => c.name() === 'agent');
    assert.ok(agent);
    agent!.action((options) => { capturedOptions = options; });

    program.parse(['node', 'venice', 'agent', '--add-dir', '/a', '--add-dir', '/b', '-p', 'hi']);
    assert.deepStrictEqual(capturedOptions?.addDir, ['/a', '/b']);
  });

  it('parses --yolo and --auto as booleans', () => {
    const parse = (args: string[]): Record<string, unknown> | undefined => {
      const program = new Command();
      registerAgentCommand(program);
      program.exitOverride();
      let capturedOptions: Record<string, unknown> | undefined;
      const agent = program.commands.find((c) => c.name() === 'agent');
      assert.ok(agent);
      agent!.action((options) => { capturedOptions = options; });
      program.parse(['node', 'venice', 'agent', ...args]);
      return capturedOptions;
    };

    const yolo = parse(['--yolo', '-p', 'hi']);
    assert.strictEqual(yolo?.yolo, true);
    assert.strictEqual(yolo?.auto, undefined);

    const auto = parse(['--auto', '-p', 'hi']);
    assert.strictEqual(auto?.auto, true);
    assert.strictEqual(auto?.yolo, undefined);
  });
});

describe('resolveApprovalMode', () => {
  it('defaults interactive to suggest and noninteractive to auto-edit', () => {
    assert.equal(resolveApprovalMode(undefined, true), 'suggest');
    assert.equal(resolveApprovalMode(undefined, false), 'auto-edit');
  });

  it('lets an explicit approval mode win in either mode', () => {
    assert.equal(resolveApprovalMode('auto', true), 'auto');
    assert.equal(resolveApprovalMode('yolo', false), 'yolo');
    assert.equal(resolveApprovalMode('suggest', false), 'suggest');
  });
});
