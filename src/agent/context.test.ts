import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ContextManager, buildStructuredSummary } from './context.js';
import type { AgentState } from './types.js';

describe('ContextManager', () => {
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

  it('estimates tokens', () => {
    const ctx = new ContextManager();
    ctx.addConversationMessage({ role: 'user', content: 'Hello world' });
    const tokens = ctx.estimateTokens();
    assert.ok(tokens > 0);
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
    assert.strictEqual(messages.length, 1);
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
      model: 'test',
      objective: 'fix build',
      status: 'idle',
      messages: [],
      todos: [
        { id: '1', content: 'inspect', status: 'completed' },
        { id: '2', content: 'edit', status: 'in_progress' },
      ],
      relevantFiles: ['src/app.ts'],
      changedFiles: ['src/app.ts'],
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
