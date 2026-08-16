import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AgentRuntime, detectWorkspaceRoot } from './runtime.js';
import { ToolRegistry } from '../tools/registry.js';
import { readFileTool } from '../tools/filesystem/read.js';
import { writeFileTool } from '../tools/filesystem/write.js';
import { editFileTool } from '../tools/filesystem/edit.js';
import { shellTool } from '../tools/shell/execute.js';
import type { AgentTool } from '../tools/types.js';
import { VeniceModelClient } from './model-client.js';
import type { ModelResponse } from './model-client.js';
import type { AgentMessage } from './types.js';
import { McpManager } from '../mcp/manager.js';

class MockModelClient extends VeniceModelClient {
  private responses: ModelResponse[];
  private callCount = 0;

  constructor(responses: ModelResponse[]) {
    super({ model: 'mock' });
    this.responses = responses;
  }

  async complete(_messages: AgentMessage[]): Promise<ModelResponse> {
    const response = this.responses[this.callCount] ?? { content: 'done', finishReason: 'stop' };
    this.callCount++;
    return response;
  }

  async getModelContextLimit(): Promise<number> {
    return 128000;
  }
}

describe('AgentRuntime', () => {
  let tmp: string;

  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-runtime-test-')));
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'test', scripts: { build: 'echo ok' } }));
  });

  it('runs a single tool call round', async () => {
    const registry = new ToolRegistry();
    registry.register(readFileTool);

    const responses: ModelResponse[] = [
      {
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: JSON.stringify({ path: 'package.json' }) },
          },
        ],
        finishReason: 'tool_calls',
      },
      { content: 'Read package.json successfully.', finishReason: 'stop' },
    ];

    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Inspect package.json',
      approvalMode: 'auto-edit',
      maxTurns: 5,
      modelClient: new MockModelClient(responses),
      toolRegistry: registry,
    });

    const result = await runtime.run();
    assert.strictEqual(result.state.status, 'complete');
    assert.ok(result.finalMessage.includes('successfully'));
    assert.strictEqual(result.state.toolHistory.length, 1);
  });

  it('runs shell command with auto approval', async () => {
    const registry = new ToolRegistry();
    registry.register(shellTool);

    const responses: ModelResponse[] = [
      {
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'shell', arguments: JSON.stringify({ command: 'echo hello' }) },
          },
        ],
        finishReason: 'tool_calls',
      },
      { content: 'Command executed.', finishReason: 'stop' },
    ];

    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Run a command',
      approvalMode: 'auto',
      maxTurns: 5,
      modelClient: new MockModelClient(responses),
      toolRegistry: registry,
    });

    const result = await runtime.run();
    assert.strictEqual(result.state.status, 'complete');
    assert.strictEqual(result.state.toolHistory[0].toolName, 'shell');
  });

  it('blocks shell in suggest mode without approver', async () => {
    const registry = new ToolRegistry();
    registry.register(shellTool);

    const responses: ModelResponse[] = [
      {
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'shell', arguments: JSON.stringify({ command: 'echo hello' }) },
          },
        ],
        finishReason: 'tool_calls',
      },
      { content: 'Blocked.', finishReason: 'stop' },
    ];

    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Run a command',
      approvalMode: 'suggest',
      maxTurns: 5,
      modelClient: new MockModelClient(responses),
      toolRegistry: registry,
    });

    const result = await runtime.run();
    assert.strictEqual(result.state.toolHistory[0].result.ok, false);
    assert.strictEqual(result.state.toolHistory[0].result.error?.code, 'PERMISSION_DENIED');
  });

  it('detects workspace root from git or cwd', () => {
    const root = detectWorkspaceRoot(process.cwd());
    assert.ok(root);
  });

  it('blocks destructive shell commands even in yolo mode', async () => {
    const registry = new ToolRegistry();
    registry.register(shellTool);

    const responses: ModelResponse[] = [
      {
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'shell', arguments: JSON.stringify({ command: 'rm -rf /' }) },
          },
        ],
        finishReason: 'tool_calls',
      },
      { content: 'Blocked destructive command.', finishReason: 'stop' },
    ];

    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Destroy system',
      approvalMode: 'yolo',
      maxTurns: 5,
      modelClient: new MockModelClient(responses),
      toolRegistry: registry,
    });

    const result = await runtime.run();
    assert.strictEqual(result.state.toolHistory[0].result.ok, false);
    assert.strictEqual(result.state.toolHistory[0].result.error?.code, 'PERMISSION_DENIED');
  });

  it('starts an injected MCP manager during run', async () => {
    const manager = new McpManager({ mcpServers: {} });
    let started = false;
    manager.start = async () => { started = true; };
    manager.getTools = () => [];

    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Test MCP wiring',
      approvalMode: 'auto-edit',
      maxTurns: 1,
      modelClient: new MockModelClient([{ content: 'done', finishReason: 'stop' }]),
      mcpManager: manager,
    });

    await runtime.run();
    assert.strictEqual(started, true);
  });

  it('discovers project skills and exposes summaries', async () => {
    const skillDir = path.join(tmp, '.venice', 'skills', 'release');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---\nname: release\ndescription: Project release skill.\n---\n\nRelease steps.\n`
    );

    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'List skills',
      approvalMode: 'auto-edit',
      maxTurns: 2,
      modelClient: new MockModelClient([{ content: 'done', finishReason: 'stop' }]),
    });

    const result = await runtime.run();
    assert.ok(result.state.skillSummaries.some((s) => s.name === 'release'));
  });

  it('activates a skill after skill_load', async () => {
    const skillDir = path.join(tmp, '.venice', 'skills', 'release');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---\nname: release\ndescription: Project release skill.\ntools:\n  - shell\n---\n\nRelease steps.\n`
    );

    const responses: ModelResponse[] = [
      {
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'skill_load', arguments: JSON.stringify({ name: 'release' }) },
          },
        ],
        finishReason: 'tool_calls',
      },
      { content: 'Activated.', finishReason: 'stop' },
    ];

    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Load skill',
      approvalMode: 'auto-edit',
      maxTurns: 3,
      modelClient: new MockModelClient(responses),
    });

    const result = await runtime.run();
    assert.ok(result.state.activeSkills.includes('release'));
    assert.strictEqual(result.state.toolHistory[0].toolName, 'skill_load');
    assert.strictEqual(result.state.toolHistory[0].result.ok, true);
  });

  it('records a subagent report returned by spawn_agent', async () => {
    const registry = new ToolRegistry();
    const spawnAgent: AgentTool<{ task: string }, unknown> = {
      name: 'spawn_agent',
      description: 'Mock subagent tool',
      inputSchema: {
        type: 'object',
        properties: { task: { type: 'string' } },
        required: ['task'],
      },
      risk: 'execute',
      async execute() {
        return {
          ok: true,
          data: {
            mode: 'read-only',
            kind: 'review',
            task: 'Inspect source',
            status: 'complete',
            summary: 'No critical issues found.',
            findings: [{ description: 'Minor issue' }],
            recommendations: ['Add test coverage'],
            filesInspected: ['src/index.ts'],
          },
        };
      },
    };
    registry.register(spawnAgent);

    const responses: ModelResponse[] = [
      {
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'spawn_agent', arguments: JSON.stringify({ task: 'Inspect source', kind: 'review' }) },
          },
        ],
        finishReason: 'tool_calls',
      },
      { content: 'Used subagent.', finishReason: 'stop' },
    ];

    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Run subagent',
      approvalMode: 'auto',
      maxTurns: 5,
      modelClient: new MockModelClient(responses),
      toolRegistry: registry,
    });

    const result = await runtime.run();
    assert.strictEqual(result.state.status, 'complete');
    assert.ok(result.state.subagentReports);
    assert.strictEqual(result.state.subagentReports!.length, 1);
    assert.strictEqual(result.state.subagentReports![0].kind, 'review');
    assert.ok(result.events.some((e) => e.type === 'subagent_started'));
    assert.ok(result.events.some((e) => e.type === 'subagent_completed'));
  });

  it('runs validation after an edit tool and reports success', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'venice-runtime-validation-'));
    fs.writeFileSync(
      path.join(workspace, 'package.json'),
      JSON.stringify({ name: 'test', scripts: { build: 'echo ok', test: 'echo tests-ok' } })
    );
    fs.writeFileSync(path.join(workspace, 'hello.txt'), 'hello');

    const registry = new ToolRegistry();
    registry.register(editFileTool);

    const responses: ModelResponse[] = [
      {
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'edit_file',
              arguments: JSON.stringify({ path: 'hello.txt', oldString: 'hello', newString: 'hello world' }),
            },
          },
        ],
        finishReason: 'tool_calls',
      },
      { content: 'Edit applied.', finishReason: 'stop' },
    ];

    const runtime = new AgentRuntime({
      workspaceRoot: workspace,
      objective: 'Edit and validate',
      approvalMode: 'auto-edit',
      maxTurns: 5,
      modelClient: new MockModelClient(responses),
      toolRegistry: registry,
    });

    const result = await runtime.run();
    assert.strictEqual(result.state.status, 'complete');
    assert.ok(result.state.lastValidation);
    assert.strictEqual(result.state.lastValidation!.overallSuccess, true);
    assert.ok(result.state.lastValidation!.commands.some((c) => c.command === 'npm run build'));
    assert.ok(result.events.some((e) => e.type === 'validation_started'));
    assert.ok(result.events.some((e) => e.type === 'validation_completed'));
    assert.ok(result.finalMessage.includes('Validation: PASS'));
  });

  it('reports validation failures after an edit tool', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'venice-runtime-validation-fail-'));
    fs.writeFileSync(
      path.join(workspace, 'package.json'),
      JSON.stringify({ name: 'test', scripts: { build: 'echo error >&2 && exit 1' } })
    );
    fs.writeFileSync(path.join(workspace, 'hello.txt'), 'hello');

    const registry = new ToolRegistry();
    registry.register(editFileTool);

    const responses: ModelResponse[] = [
      {
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'edit_file',
              arguments: JSON.stringify({ path: 'hello.txt', oldString: 'hello', newString: 'hello world' }),
            },
          },
        ],
        finishReason: 'tool_calls',
      },
      { content: 'Edit applied.', finishReason: 'stop' },
    ];

    const runtime = new AgentRuntime({
      workspaceRoot: workspace,
      objective: 'Edit and validate',
      approvalMode: 'auto-edit',
      maxTurns: 5,
      modelClient: new MockModelClient(responses),
      toolRegistry: registry,
    });

    const result = await runtime.run();
    assert.strictEqual(result.state.status, 'complete');
    assert.ok(result.state.lastValidation);
    assert.strictEqual(result.state.lastValidation!.overallSuccess, false);
    assert.ok(result.finalMessage.includes('Validation: FAIL'));
  });

  it('skips validation when no edit occurs', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'venice-runtime-no-validation-'));
    fs.writeFileSync(
      path.join(workspace, 'package.json'),
      JSON.stringify({ name: 'test', scripts: { build: 'echo ok' } })
    );
    fs.writeFileSync(path.join(workspace, 'hello.txt'), 'hello');

    const registry = new ToolRegistry();
    registry.register(readFileTool);

    const responses: ModelResponse[] = [
      {
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: JSON.stringify({ path: 'hello.txt' }) },
          },
        ],
        finishReason: 'tool_calls',
      },
      { content: 'Read file.', finishReason: 'stop' },
    ];

    const runtime = new AgentRuntime({
      workspaceRoot: workspace,
      objective: 'Read only',
      approvalMode: 'auto-edit',
      maxTurns: 5,
      modelClient: new MockModelClient(responses),
      toolRegistry: registry,
    });

    const result = await runtime.run();
    assert.strictEqual(result.state.lastValidation, undefined);
    assert.ok(!result.events.some((e) => e.type === 'validation_started'));
  });

  it('skips validation when autoValidate is false', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'venice-runtime-no-auto-validation-'));
    fs.writeFileSync(
      path.join(workspace, 'package.json'),
      JSON.stringify({ name: 'test', scripts: { build: 'echo ok' } })
    );
    fs.writeFileSync(path.join(workspace, 'hello.txt'), 'hello');

    const registry = new ToolRegistry();
    registry.register(writeFileTool);

    const responses: ModelResponse[] = [
      {
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'write_file', arguments: JSON.stringify({ path: 'new.txt', content: 'new' }) },
          },
        ],
        finishReason: 'tool_calls',
      },
      { content: 'Wrote file.', finishReason: 'stop' },
    ];

    const runtime = new AgentRuntime({
      workspaceRoot: workspace,
      objective: 'Write without validation',
      approvalMode: 'auto-edit',
      autoValidate: false,
      maxTurns: 5,
      modelClient: new MockModelClient(responses),
      toolRegistry: registry,
    });

    const result = await runtime.run();
    assert.strictEqual(result.state.lastValidation, undefined);
    assert.ok(!result.events.some((e) => e.type === 'validation_started'));
    assert.ok(result.state.changedFiles.includes('new.txt'));
  });
});
