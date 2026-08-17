import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createSpawnAgentTool, createSubagentRegistry } from './spawn-agent.js';
import type { AgentState, ToolInvocation } from '../../agent/types.js';

const makeState = (): Readonly<AgentState> =>
  ({
    sessionId: 's1',
    workspaceRoot: '/tmp/workspace',
    workspace: { primaryRoot: '/tmp/workspace', additionalRoots: [] },
    model: 'test-model',
    objective: 'test',
    status: 'idle',
    mode: { inputMode: 'agent', operatingMode: 'agent', permissionMode: 'suggest' },
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
  it('keeps read-only and write registries within their declared boundaries', async () => {
    const readOnlyNames = (await createSubagentRegistry('read-only')).definitions().map((tool) => tool.function.name);
    const writeNames = (await createSubagentRegistry('write')).definitions().map((tool) => tool.function.name);

    assert.ok(!readOnlyNames.includes('write_file'));
    assert.ok(writeNames.includes('write_file'));
    assert.ok(writeNames.includes('edit_file'));
    assert.ok(writeNames.includes('apply_patch'));
    for (const forbidden of ['shell', 'spawn_agent', 'web_search', 'generate_image', 'run_validation']) {
      assert.ok(!writeNames.includes(forbidden));
    }
  });

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
    assert.deepStrictEqual(data.changedFiles, []);
  });

  it('rejects write attempts by subagents', async () => {
    const tool = createSpawnAgentTool({
      runSubagent: async () => ({
        finalMessage: '{"summary":"bad"}',
        state: {
          status: 'complete',
          changedFiles: [{ rootId: '/ws', relativePath: 'src/unsafe.ts' }],
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

  it('declares subagentStarted and recordSubagentReport effects', async () => {
    const tool = createSpawnAgentTool({
      runSubagent: async () => ({
        finalMessage: '{"summary":"done"}',
        state: { status: 'complete', changedFiles: [], toolHistory: [] },
      }),
    });

    const start = tool.startEffects!({ task: 'inspect', kind: 'review', mode: 'read-only', maxTurns: 10 });
    assert.strictEqual(start.length, 1);
    assert.strictEqual(start[0].type, 'subagentStarted');
    if (start[0].type === 'subagentStarted') {
      assert.strictEqual(start[0].kind, 'review');
      assert.strictEqual(start[0].mode, 'read-only');
      assert.strictEqual(start[0].task, 'inspect');
    }

    const result = await tool.execute({ task: 'inspect', kind: 'review' }, context);
    const effects = tool.effects!(result);
    assert.strictEqual(effects.length, 1);
    assert.strictEqual(effects[0].type, 'recordSubagentReport');
    if (effects[0].type === 'recordSubagentReport') {
      assert.strictEqual(effects[0].report.kind, 'review');
    }
  });

  it('allows write mode and reports affected files', async () => {
    let receivedMode = '';
    const tool = createSpawnAgentTool({
      runSubagent: async (options) => {
        receivedMode = options.mode;
        return {
          finalMessage: '{"summary":"Updated source."}',
          state: {
            status: 'complete',
            changedFiles: [{ rootId: '/ws', relativePath: 'src/a.ts' }],
            toolHistory: [],
          },
        };
      },
    });

    const result = await tool.execute({ task: 'update source', mode: 'write' }, context);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(receivedMode, 'write');
    assert.strictEqual(result.data?.mode, 'write');
    assert.deepStrictEqual(result.data?.changedFiles, [{ rootId: '/ws', relativePath: 'src/a.ts' }]);
    assert.deepStrictEqual(result.metadata?.affectedFiles, [{ rootId: '/ws', relativePath: 'src/a.ts' }]);
  });
});
