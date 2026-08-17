import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ContextManager, buildStructuredSummary } from './context.js';
import type { AgentState } from './types.js';

describe('ContextManager', () => {
  it('keeps attached source separate from project instructions', () => {
    const manager = new ContextManager();
    manager.setProjectInstructions('PROJECT RULE');
    manager.setFileContext([{ role: 'user', content: 'UNTRUSTED SOURCE' }]);
    const messages = manager.buildMessages();
    assert.match(String(messages[0].content), /PROJECT RULE/);
    assert.strictEqual(messages[1].role, 'user');
    assert.strictEqual(messages[1].content, 'UNTRUSTED SOURCE');
  });
  it('builds messages with system content', () => {
    const ctx = new ContextManager();
    ctx.setProjectInstructions('Use TypeScript strict mode.');
    const messages = ctx.buildMessages();
    assert.strictEqual(messages[0].role, 'system');
    const content = String(messages[0].content);
    assert.ok(content.includes('Venice Agent'));
    assert.ok(content.includes('TypeScript strict mode'));
  });

  it('includes conversation messages', () => {
    const ctx = new ContextManager();
    ctx.addConversationMessage({ role: 'user', content: 'Hello' });
    ctx.addConversationMessage({ role: 'assistant', content: 'Hi' });
    const messages = ctx.buildMessages();
    assert.strictEqual(messages.length, 3);
    assert.strictEqual(messages[1].role, 'user');
    assert.strictEqual(messages[2].role, 'assistant');
  });

  it('keeps assistant tool calls immediately before their tool results', () => {
    const manager = new ContextManager();
    manager.addConversationMessage({ role: 'user', content: 'inspect' });
    manager.addConversationMessage({
      role: 'assistant', content: '',
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read_file', arguments: '{"path":"package.json"}' } }],
    });
    manager.addToolResult('call-1', '{"name":"veniceai-cli"}');
    const messages = manager.buildMessages();
    assert.deepEqual(messages.slice(-3).map((message) => message.role), ['user', 'assistant', 'tool']);
    assert.equal(messages.at(-1)?.tool_call_id, 'call-1');
  });

  it('estimates tokens', () => {
    const ctx = new ContextManager();
    ctx.addConversationMessage({ role: 'user', content: 'Hello world' });
    const tokens = ctx.estimateTokens();
    assert.ok(tokens > 0);
  });

  it('calibrates the estimate from real usage feedback (P2)', () => {
    const ctx = new ContextManager();
    ctx.addConversationMessage({ role: 'user', content: 'Hello world' });
    const before = ctx.estimateTokens();
    const bytes = Buffer.byteLength(JSON.stringify(ctx.buildMessages()), 'utf-8');

    // Report a lower tokens-per-byte than the naive heuristic (dense text).
    ctx.calibrate(bytes, Math.ceil(bytes / 6));
    const after = ctx.estimateTokens();
    assert.ok(after < before, 'calibration must lower the estimate when tokens-per-byte is lower');

    // Bogus usage (0 / negative) must not corrupt the factor.
    ctx.calibrate(bytes, 0);
    assert.strictEqual(ctx.estimateTokens(), after);
  });

  it('compacts context', () => {
    const ctx = new ContextManager();
    ctx.addConversationMessage({ role: 'user', content: 'Hello' });
    ctx.compact({
      objective: 'test',
      completedWork: ['greeting'],
      remainingWork: [],
      decisions: [],
      discoveries: [],
      filesRead: [],
      filesChanged: [],
      commandsRun: [],
      failures: [],
      importantConstraints: [],
    });
    const messages = ctx.buildMessages();
    const system = String(messages[0].content);
    assert.ok(system.includes('greeting'));
    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[1].content, 'Hello');
  });

  it('preserves a continuation hint in the compacted summary (VC-KIMI-049)', () => {
    const ctx = new ContextManager();
    ctx.addConversationMessage({ role: 'user', content: 'Hello' });
    ctx.compact({
      objective: 'test',
      hint: 'focus on the parser',
      completedWork: [],
      remainingWork: [],
      decisions: [],
      discoveries: [],
      filesRead: [],
      filesChanged: [],
      commandsRun: [],
      failures: [],
      importantConstraints: [],
    });
    const system = String(ctx.buildMessages()[0].content);
    assert.ok(system.includes('Continuation hint: focus on the parser'));
  });

  it('accepts model context limit', () => {
    const ctx = new ContextManager();
    ctx.setModelContextLimit(32000);
    // With 32k limit and 16k reserved, compaction threshold is 12k.
    // Add enough text to exceed it.
    ctx.addConversationMessage({ role: 'user', content: 'x'.repeat(50000) });
    assert.ok(ctx.shouldCompact());
  });

  it('preserves important state after compaction', () => {
    const ctx = new ContextManager();
    ctx.addConversationMessage({ role: 'user', content: 'Hello' });
    ctx.compact({
      objective: 'fix build',
      completedWork: [],
      remainingWork: ['edit file'],
      decisions: ['use patch'],
      discoveries: [],
      filesRead: [],
      filesChanged: ['src/app.ts'],
      commandsRun: [],
      failures: ['test failed'],
      importantConstraints: ['do not break API'],
    });
    const system = String(ctx.buildMessages()[0].content);
    assert.ok(system.includes('fix build'));
    assert.ok(system.includes('edit file'));
    assert.ok(system.includes('src/app.ts'));
    assert.ok(system.includes('test failed'));
  });

  it('resets conversation', () => {
    const ctx = new ContextManager();
    ctx.addConversationMessage({ role: 'user', content: 'Hello' });
    ctx.resetConversation();
    const messages = ctx.buildMessages();
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].role, 'system');
  });
});

describe('buildStructuredSummary', () => {
  it('summarizes state', () => {
    const state: AgentState = {
      sessionId: 's1',
      workspaceRoot: '/tmp',
      workspace: { primaryRoot: '/tmp', additionalRoots: [] },
      model: 'test',
      objective: 'fix build',
      status: 'idle',
      mode: { inputMode: 'agent', operatingMode: 'agent', permissionMode: 'suggest' },
      messages: [],
      todos: [
        { id: '1', content: 'inspect', status: 'completed' },
        { id: '2', content: 'edit', status: 'in_progress' },
      ],
      relevantFiles: ['src/app.ts'],
      changedFiles: [{ rootId: '/tmp', relativePath: 'src/app.ts' }],
      toolHistory: [
        {
          id: '1',
          toolName: 'read_file',
          input: { path: 'src/app.ts' },
          result: { ok: true, data: 'x' },
          approved: true,
          durationMs: 10,
          timestamp: new Date().toISOString(),
        },
      ],
      skillSummaries: [],
      activeSkills: [],
    } as AgentState;
    const summary = buildStructuredSummary(state);
    assert.deepStrictEqual(summary.completedWork, ['inspect']);
    assert.ok(summary.remainingWork.includes('edit'));
    assert.deepStrictEqual(summary.filesRead, ['src/app.ts']);
  });
});
