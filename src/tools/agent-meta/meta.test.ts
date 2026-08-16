import { describe, it } from 'node:test';
import assert from 'node:assert';
import { todoReadTool } from './todo-read.js';
import { todoWriteTool } from './todo-write.js';
import { askUserTool } from './ask-user.js';
import type { AgentState } from '../../agent/types.js';

const makeState = (todos: AgentState['todos']): Readonly<AgentState> =>
  ({
    sessionId: 's1',
    workspaceRoot: '/tmp',
    model: 'test-model',
    objective: 'test',
    status: 'idle',
    messages: [],
    todos,
    relevantFiles: [],
    changedFiles: [],
    toolHistory: [],
    skillSummaries: [],
    activeSkills: [],
  }) as Readonly<AgentState>;

const context = (state: AgentState['todos']) => ({
  workspaceRoot: '/tmp',
  sessionId: 's1',
  objective: 'test',
  runtimeState: makeState(state),
});

describe('agent-meta tools', () => {
  it('todo_read returns current todos', async () => {
    const todos = [{ id: '1', content: 'inspect', status: 'pending' as const }];
    const result = await todoReadTool.execute({}, context(todos));
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.data, todos);
  });

  it('todo_write validates and returns new todos', async () => {
    const todos = [{ id: '1', content: 'done', status: 'completed' as const }];
    const result = await todoWriteTool.execute({ todos }, context([]));
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.data, todos);
  });

  it('todo_write rejects invalid status', async () => {
    const result = await todoWriteTool.execute(
      { todos: [{ id: '1', content: 'bad', status: 'unknown' as any }] },
      context([])
    );
    assert.strictEqual(result.ok, false);
  });

  it('ask_user returns structured request', async () => {
    const result = await askUserTool.execute({ question: 'Proceed?' }, context([]));
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.data, { question: 'Proceed?' });
  });
});
