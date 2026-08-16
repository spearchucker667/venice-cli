import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createSpawnAgentTool } from './spawn-agent.js';
import type { AgentState, ToolInvocation } from '../../agent/types.js';

const makeState = (): Readonly<AgentState> =>
  ({
    sessionId: 's1',
    workspaceRoot: '/tmp/workspace',
    model: 'test-model',
    objective: 'test',
    status: 'idle',
    messages: [],
    todos: [],
    relevantFiles: [],
    changedFiles: [],
    toolHistory: [],
    skillSummaries: [],
    activeSkills: [],
    subagentReports: [],
  }) as Readonly<AgentState>;

const context = {
  workspaceRoot: '/tmp/workspace',
  sessionId: 's1',
  objective: 'parent-task',
  runtimeState: makeState(),
};

describe('spawn_agent tool', () => {
  it('rejects an empty task', async () => {
    const tool = createSpawnAgentTool({
      runSubagent: async () => {
        throw new Error('should not run');
      },
    });
    const result = await tool.execute({ task: '   ' }, context);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error?.code, 'INVALID_SUBAGENT_TASK');
  });

  it('returns a structured report', async () => {
    const history: ToolInvocation[] = [
      {
        id: '1',
        toolName: 'read_file',
        input: { path: 'src/a.ts' },
        result: { ok: true, data: 'x' },
        approved: true,
        durationMs: 1,
        timestamp: new Date().toISOString(),
      },
      {
        id: '2',
        toolName: 'grep',
        input: { pattern: 'TODO' },
        result: { ok: true, data: [{ file: 'src/b.ts', line: 4, text: 'TODO' }] },
        approved: true,
        durationMs: 1,
        timestamp: new Date().toISOString(),
      },
    ];

    const tool = createSpawnAgentTool({
      runSubagent: async () => ({
        finalMessage: JSON.stringify({
          summary: 'Found one issue.',
          findings: [{ severity: 'medium', file: 'src/b.ts', line: 4, description: 'TODO left in code' }],
          recommendations: ['Resolve TODO'],
        }),
        state: {
          status: 'complete',
          changedFiles: [],
          toolHistory: history,
        },
      }),
    });

    const result = await tool.execute({ task: 'review TODOs', kind: 'review' }, context);
    assert.strictEqual(result.ok, true);
    const data = result.data!;
    assert.strictEqual(data.kind, 'review');
    assert.strictEqual(data.mode, 'read-only');
    assert.strictEqual(data.summary, 'Found one issue.');
    assert.strictEqual(data.findings.length, 1);
    assert.deepStrictEqual(data.filesInspected, ['src/a.ts', 'src/b.ts']);
  });

  it('rejects write attempts by subagents', async () => {
    const tool = createSpawnAgentTool({
      runSubagent: async () => ({
        finalMessage: '{"summary":"bad"}',
        state: {
          status: 'complete',
          changedFiles: ['src/unsafe.ts'],
          toolHistory: [],
        },
      }),
    });

    const result = await tool.execute({ task: 'do something unsafe' }, context);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error?.code, 'SUBAGENT_WRITE_DETECTED');
  });

  it('forwards normalized maxTurns to subagent runner', async () => {
    let receivedMaxTurns = -1;
    const tool = createSpawnAgentTool({
      runSubagent: async (options) => {
        receivedMaxTurns = options.maxTurns;
        return {
          finalMessage: 'Done',
          state: {
            status: 'complete',
            changedFiles: [],
            toolHistory: [],
          },
        };
      },
    });

    const result = await tool.execute({ task: 'inspect', maxTurns: 999 }, context);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(receivedMaxTurns, 20);
  });
});
