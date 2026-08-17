import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AgentRuntime, detectWorkspaceRoot } from './runtime.js';
import { PermissionManager } from './permissions.js';
import { SessionManager } from './sessions.js';
import { ToolRegistry } from '../tools/registry.js';
import { readFileTool } from '../tools/filesystem/read.js';
import { writeFileTool } from '../tools/filesystem/write.js';
import { editFileTool } from '../tools/filesystem/edit.js';
import { shellTool } from '../tools/shell/execute.js';
import type { AgentTool } from '../tools/types.js';
import { VeniceModelClient, UNKNOWN_CONTEXT_LIMIT } from './model-client.js';
import type { ModelResponse } from './model-client.js';
import type { AgentMessage } from './types.js';
import { McpManager } from '../mcp/manager.js';
import type { ToolDefinition } from '../types/index.js';
import type { ModelProfile } from './model-profile.js';

class MockModelClient extends VeniceModelClient {
  private responses: ModelResponse[];
  private callCount = 0;
  readonly requestedTools: ToolDefinition[][] = [];

  constructor(responses: ModelResponse[]) {
    super({ model: 'mock' });
    this.responses = responses;
  }

  async complete(_messages: AgentMessage[], tools: ToolDefinition[] = []): Promise<ModelResponse> {
    this.requestedTools.push(tools);
    const response = this.responses[this.callCount] ?? { content: 'done', finishReason: 'stop' };
    this.callCount++;
    return response;
  }

  async getModelContextLimit(): Promise<number> {
    return 128000;
  }

  async getModelProfile(): Promise<ModelProfile | undefined> {
    return undefined;
  }
}

/** Records the messages seen on each `complete` call. */
class RecordingModelClient extends MockModelClient {
  readonly seenMessages: AgentMessage[][] = [];

  async complete(messages: AgentMessage[], tools: ToolDefinition[] = []): Promise<ModelResponse> {
    this.seenMessages.push(messages);
    return super.complete(messages, tools);
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
    assert.ok(result.events.some((event) => event.type === 'assistant_complete' && event.content?.includes('successfully')));
  });

  it('sends the live tool registry to agent-capable models', async () => {
    const registry = new ToolRegistry();
    registry.register(readFileTool);
    const client = new MockModelClient([{ content: 'done', finishReason: 'stop' }]);
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Inspect files',
      modelClient: client,
      toolRegistry: registry,
    });
    // Positive capability evidence is required for agent mode (VCL-R3-006);
    // the mock's profile fetch returns undefined, so the test declares it.
    runtime.setModelProfile({
      id: runtime.getState().model,
      mode: 'agent',
      supportsFunctionCalling: true,
    });

    await runtime.run();
    assert.deepEqual(client.requestedTools[0].map((tool) => tool.function.name), ['read_file']);
  });

  it('withholds tools from models advertised as chat-only', async () => {
    const registry = new ToolRegistry();
    registry.register(readFileTool);
    const client = new MockModelClient([{ content: 'chat response', finishReason: 'stop' }]);
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Talk without tools',
      model: 'chat-model',
      modelClient: client,
      toolRegistry: registry,
    });
    runtime.setModelProfile({
      id: 'chat-model',
      mode: 'chat-only',
      supportsFunctionCalling: false,
    });

    await runtime.run();
    assert.deepEqual(client.requestedTools[0], []);
    assert.equal(runtime.getState().agentMode, 'chat-only');
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
            changedFiles: [],
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

  it('retains changed files across later tool calls', async () => {
    const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-runtime-changes-')));
    const registry = new ToolRegistry();
    registry.register(writeFileTool);
    registry.register(readFileTool);
    const responses: ModelResponse[] = [
      {
        content: '',
        toolCalls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'write_file', arguments: JSON.stringify({ path: 'created.txt', content: 'created' }) },
        }],
        finishReason: 'tool_calls',
      },
      {
        content: '',
        toolCalls: [{
          id: 'call_2',
          type: 'function',
          function: { name: 'read_file', arguments: JSON.stringify({ path: 'created.txt' }) },
        }],
        finishReason: 'tool_calls',
      },
      { content: 'Done.', finishReason: 'stop' },
    ];

    const runtime = new AgentRuntime({
      workspaceRoot: workspace,
      objective: 'Write then inspect',
      approvalMode: 'auto-edit',
      autoValidate: false,
      modelClient: new MockModelClient(responses),
      toolRegistry: registry,
    });

    const result = await runtime.run();
    assert.deepStrictEqual(result.state.changedFiles, [
      { rootId: workspace, relativePath: 'created.txt' },
    ]);
    fs.rmSync(workspace, { recursive: true, force: true });
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

    const permissions = new PermissionManager('auto-edit');
    const runtime = new AgentRuntime({
      workspaceRoot: workspace,
      objective: 'Edit and validate',
      approvalMode: 'auto-edit',
      maxTurns: 5,
      modelClient: new MockModelClient(responses),
      toolRegistry: registry,
      permissionManager: permissions,
    });
    // Repo-defined package scripts execute repository-controlled code and
    // require explicit workspace execution trust (VCL-R3-001). Grant it here
    // to model the user having approved validation for this session.
    permissions.grant('session', 'run_validation', undefined, 'execute');

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

    const permissions = new PermissionManager('auto-edit');
    const runtime = new AgentRuntime({
      workspaceRoot: workspace,
      objective: 'Edit and validate',
      approvalMode: 'auto-edit',
      maxTurns: 5,
      modelClient: new MockModelClient(responses),
      toolRegistry: registry,
      permissionManager: permissions,
    });
    permissions.grant('session', 'run_validation', undefined, 'execute');

    const result = await runtime.run();
    assert.strictEqual(result.state.status, 'complete');
    assert.ok(result.state.lastValidation);
    assert.strictEqual(result.state.lastValidation!.overallSuccess, false);
    assert.ok(result.finalMessage.includes('Validation: FAIL'));
  });

  it('validates the additional root that owns the edit (VCL-R3-023)', async () => {
    const primary = fs.mkdtempSync(path.join(os.tmpdir(), 'venice-runtime-primary-validate-'));
    // realpath: WorkspaceManager canonicalizes roots (e.g. /var -> /private/var).
    const shared = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-runtime-shared-validate-')));
    // The additional root is the one with a package.json build script.
    fs.writeFileSync(
      path.join(shared, 'package.json'),
      JSON.stringify({ name: 'shared', scripts: { build: 'echo shared-build-ok' } })
    );
    fs.mkdirSync(path.join(shared, 'src'), { recursive: true });
    fs.writeFileSync(path.join(shared, 'src', 'a.ts'), 'shared-original');

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
              arguments: JSON.stringify({
                path: path.join(shared, 'src', 'a.ts'),
                oldString: 'shared-original',
                newString: 'shared-edited',
              }),
            },
          },
        ],
        finishReason: 'tool_calls',
      },
      { content: 'Edited.', finishReason: 'stop' },
    ];

    const permissions = new PermissionManager('auto-edit');
    const runtime = new AgentRuntime({
      workspaceRoot: primary,
      objective: 'Edit shared file',
      approvalMode: 'auto-edit',
      maxTurns: 5,
      modelClient: new MockModelClient(responses),
      toolRegistry: registry,
      permissionManager: permissions,
      additionalRoots: [shared],
    });
    permissions.grant('session', 'run_validation', undefined, 'execute');

    const result = await runtime.run();
    assert.strictEqual(result.state.status, 'complete');
    assert.ok(result.state.lastValidation, 'validation must run for the additional root');
    const started = result.events.filter((e) => e.type === 'validation_started');
    assert.ok(started.length > 0, 'validation must be triggered by the additional-root edit');
    // Every validation command ran in the additional root, not the primary.
    for (const event of started) {
      if (event.type === 'validation_started') {
        assert.strictEqual(event.root, shared);
      }
    }
    assert.ok(result.state.lastValidation.commands.some((c) => c.command === 'npm run build' && c.root === shared));

    fs.rmSync(primary, { recursive: true, force: true });
    fs.rmSync(shared, { recursive: true, force: true });
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
    assert.ok(result.state.changedFiles.some((f) => f.relativePath === 'new.txt'));
  });

  it('supports persistent follow-up messages in the same runtime', async () => {
    const registry = new ToolRegistry();
    registry.register(readFileTool);

    const responses: ModelResponse[] = [
      { content: 'First response.', finishReason: 'stop' },
      { content: 'Second response.', finishReason: 'stop' },
    ];

    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Initial task',
      approvalMode: 'auto-edit',
      maxTurns: 5,
      modelClient: new MockModelClient(responses),
      toolRegistry: registry,
    });

    const first = await runtime.sendUserMessage('Initial task');
    assert.strictEqual(first, 'First response.');
    assert.strictEqual(runtime.getState().messages.filter((m) => m.role === 'user').length, 1);

    const second = await runtime.sendUserMessage('Follow-up');
    assert.strictEqual(second, 'Second response.');
    assert.strictEqual(runtime.getState().messages.filter((m) => m.role === 'user').length, 2);
    assert.strictEqual(runtime.getState().messages.filter((m) => m.role === 'assistant').length, 2);
    assert.strictEqual(runtime.getState().status, 'complete');

    const result = await runtime.complete();
    assert.ok(result.events.some((e) => e.type === 'session_completed'));
    assert.strictEqual(result.state.sessionId, runtime.getState().sessionId);
  });

  it('can change model mid-session', async () => {
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Test model switch',
      approvalMode: 'auto-edit',
      maxTurns: 2,
      modelClient: new MockModelClient([{ content: 'done', finishReason: 'stop' }]),
    });

    runtime.setModel('another-model');
    assert.strictEqual(runtime.getState().model, 'another-model');

    await runtime.run();
    assert.strictEqual(runtime.getState().model, 'another-model');
  });

  it('loads persisted state and continues', async () => {
    const registry = new ToolRegistry();
    registry.register(readFileTool);

    const firstRuntime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Original objective',
      approvalMode: 'auto-edit',
      maxTurns: 2,
      modelClient: new MockModelClient([{ content: 'original', finishReason: 'stop' }]),
      toolRegistry: registry,
    });

    await firstRuntime.run();
    const persisted = firstRuntime.getState();
    assert.ok(persisted.messages.length > 0);

    const secondRuntime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: '',
      approvalMode: 'auto-edit',
      maxTurns: 2,
      modelClient: new MockModelClient([{ content: 'resumed', finishReason: 'stop' }]),
      toolRegistry: registry,
    });

    secondRuntime.loadState(persisted);
    assert.strictEqual(secondRuntime.getState().sessionId, persisted.sessionId);
    assert.strictEqual(secondRuntime.getState().objective, persisted.objective);

    const followUp = await secondRuntime.sendUserMessage('Follow-up after resume');
    assert.strictEqual(followUp, 'resumed');
    assert.ok(secondRuntime.getState().messages.some((m) => m.role === 'user' && m.content === 'Follow-up after resume'));
  });

  it('rejects persisted state from a different workspace', () => {
    const otherWorkspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-runtime-other-')));
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Current workspace',
      modelClient: new MockModelClient([]),
    });
    const foreignState = {
      ...runtime.getState(),
      workspaceRoot: otherWorkspace,
    };

    assert.throws(() => runtime.loadState(foreignState), /different workspace/);
    assert.strictEqual(runtime.getState().workspaceRoot, tmp);
    fs.rmSync(otherWorkspace, { recursive: true, force: true });
  });

  it('emits session_completed only once even if complete is called after run', async () => {
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Test completion',
      approvalMode: 'auto-edit',
      maxTurns: 2,
      modelClient: new MockModelClient([{ content: 'done', finishReason: 'stop' }]),
    });

    const first = await runtime.run();
    const completedCount = first.events.filter((e) => e.type === 'session_completed').length;
    assert.strictEqual(completedCount, 1);

    const second = await runtime.complete();
    const secondCompletedCount = second.events.filter((e) => e.type === 'session_completed').length;
    assert.strictEqual(secondCompletedCount, 1);
  });

  it('merges --add-dir roots into the workspace authority and de-duplicates', () => {
    const extra = path.join(tmp, 'extra');
    fs.mkdirSync(extra, { recursive: true });
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Multi-root test',
      approvalMode: 'auto-edit',
      additionalRoots: [extra, extra],
      modelClient: new MockModelClient([]),
    });
    const workspace = runtime.getState().workspace;
    assert.strictEqual(workspace.primaryRoot, tmp);
    assert.deepStrictEqual(workspace.additionalRoots, [extra]);
    assert.ok(Array.isArray(runtime.getSkillErrors()));
  });

  it('records a /compact hint in the emitted summary (VC-KIMI-049)', () => {
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Compact hint test',
      approvalMode: 'auto-edit',
      modelClient: new MockModelClient([]),
    });
    runtime.forceCompact('keep the parser in mind');
    const manager = runtime.getContextManager();
    const system = String(manager.buildMessages()[0].content);
    assert.ok(system.includes('Continuation hint: keep the parser in mind'));
  });

  it('records and persists direct shell calls with their source (VC-KIMI-054)', async () => {
    const sessionsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'venice-sessions-'));
    const sessions = new SessionManager(sessionsRoot);
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Direct shell trace',
      approvalMode: 'yolo',
      modelClient: new MockModelClient([]),
      sessionManager: sessions,
    });
    try {
      const result = await runtime.executeDirectTool('shell', { command: 'echo direct' }, { source: 'shell-mode' });
      assert.strictEqual(result.ok, true);

      const history = runtime.getState().toolHistory;
      assert.strictEqual(history.length, 1);
      assert.strictEqual(history[0].toolName, 'shell');
      assert.strictEqual(history[0].source, 'shell-mode');

      // executeDirectTool persists immediately, so the trace survives without
      // a subsequent turn or clean shutdown.
      const loaded = sessions.load(runtime.getState().sessionId);
      assert.ok(loaded, 'direct tool call must be persisted');
      assert.strictEqual(loaded.state.toolHistory[0]?.source, 'shell-mode');
    } finally {
      fs.rmSync(sessionsRoot, { recursive: true, force: true });
    }
  });

  it('drains messages queued around a turn (VC-KIMI-053)', async () => {
    const client = new MockModelClient([
      { content: 'first', finishReason: 'stop' },
      { content: 'queued', finishReason: 'stop' },
    ]);
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Queue drain',
      approvalMode: 'auto-edit',
      maxTurns: 5,
      modelClient: client,
    });
    runtime.queueUserMessage('queued message');
    const final = await runtime.sendUserMessage('first');
    assert.strictEqual(final, 'queued');
    assert.strictEqual(runtime.getQueuedMessageCount(), 0);
    const userMessages = runtime.getState().messages.filter((m) => m.role === 'user').map((m) => m.content);
    assert.deepStrictEqual(userMessages, ['first', 'queued message']);
  });

  it('accepts a message queued while a turn is running (VC-KIMI-053)', async () => {
    const client = new MockModelClient([
      { content: 'first', finishReason: 'stop' },
      { content: 'queued', finishReason: 'stop' },
    ]);
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Queue while running',
      approvalMode: 'auto-edit',
      maxTurns: 5,
      modelClient: client,
    });
    let queued = false;
    const originalComplete = client.complete.bind(client);
    client.complete = async (messages: AgentMessage[], tools: ToolDefinition[] = []) => {
      const result = await originalComplete(messages, tools);
      if (!queued) {
        queued = true;
        runtime.queueUserMessage('queued while running');
      }
      return result;
    };
    const final = await runtime.sendUserMessage('first');
    assert.strictEqual(final, 'queued');
    assert.strictEqual(runtime.getQueuedMessageCount(), 0);
    const userMessages = runtime.getState().messages.filter((m) => m.role === 'user').map((m) => m.content);
    assert.deepStrictEqual(userMessages, ['first', 'queued while running']);
  });

  it('injects a message into the current turn after a tool boundary (VC-KIMI-053)', async () => {
    const registry = new ToolRegistry();
    registry.register(readFileTool);

    const client = new RecordingModelClient([
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
      { content: 'after injection', finishReason: 'stop' },
    ]);

    let runtime: AgentRuntime | undefined;
    let injected = false;
    const originalComplete = client.complete.bind(client);
    client.complete = async (messages: AgentMessage[], tools: ToolDefinition[] = []) => {
      const result = await originalComplete(messages, tools);
      if (!injected) {
        injected = true;
        runtime?.injectUserMessage('injected note');
      }
      return result;
    };

    runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Inject into turn',
      approvalMode: 'auto-edit',
      maxTurns: 5,
      modelClient: client,
      toolRegistry: registry,
    });
    // Prevent the test-only default budget (maxTokens 0) from compacting the
    // conversation between the two model requests.
    runtime.getContextManager().setModelContextLimit(128000);

    await runtime.sendUserMessage('start');

    // The second model request must include the injected user message.
    const secondRequestUsers = client.seenMessages[1]?.filter((m) => m.role === 'user').map((m) => m.content);
    assert.deepStrictEqual(secondRequestUsers, ['start', 'injected note']);
  });

  it('queues an injection that arrives with no active turn (VC-KIMI-053)', () => {
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Idle injection',
      approvalMode: 'auto-edit',
      modelClient: new MockModelClient([]),
    });
    runtime.injectUserMessage('idle note');
    assert.strictEqual(runtime.getQueuedMessageCount(), 1, 'idle injection falls back to the queue');
  });

  it('collects a real answer for ask_user (VC-KIMI-058)', async () => {
    const client = new MockModelClient([
      {
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'ask_user', arguments: JSON.stringify({ question: 'Which?', options: ['A', 'B'] }) },
          },
        ],
        finishReason: 'tool_calls',
      },
      { content: 'got the answer', finishReason: 'stop' },
    ]);
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Ask',
      approvalMode: 'auto-edit',
      maxTurns: 5,
      modelClient: client,
    });
    runtime.setUserQuestionHandler(async (request) => ({ id: request.id, answers: ['A'] }));

    const final = await runtime.sendUserMessage('ask the user');
    assert.strictEqual(final, 'got the answer');

    const ask = runtime.getState().toolHistory.find((t) => t.toolName === 'ask_user');
    assert.ok(ask, 'ask_user call is traced');
    assert.strictEqual(ask.result.ok, true);
    assert.deepStrictEqual((ask.result.data as { answers?: string[] }).answers, ['A']);
  });

  it('reports INTERACTION_REQUIRED for ask_user with no collector (VC-KIMI-058)', async () => {
    const client = new MockModelClient([
      {
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'ask_user', arguments: JSON.stringify({ question: 'Which?' }) },
          },
        ],
        finishReason: 'tool_calls',
      },
      { content: 'fallback', finishReason: 'stop' },
    ]);
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Ask',
      approvalMode: 'auto-edit',
      maxTurns: 5,
      modelClient: client,
    });

    await runtime.sendUserMessage('ask');

    const ask = runtime.getState().toolHistory.find((t) => t.toolName === 'ask_user');
    assert.ok(ask);
    assert.strictEqual(ask.result.ok, false);
    assert.strictEqual(ask.result.error?.code, 'INTERACTION_REQUIRED');
  });

  it('tracks an additional-root edit with root-aware identity (VCL-R3-004)', async () => {
    const primary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-r3-primary-')));
    const shared = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-r3-shared-')));
    fs.mkdirSync(path.join(shared, 'src'), { recursive: true });
    fs.writeFileSync(path.join(shared, 'src', 'a.ts'), 'shared-original');
    fs.mkdirSync(path.join(primary, 'src'), { recursive: true });
    fs.writeFileSync(path.join(primary, 'src', 'a.ts'), 'primary-version');

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
              arguments: JSON.stringify({
                path: path.join(shared, 'src', 'a.ts'),
                oldString: 'shared-original',
                newString: 'shared-edited',
              }),
            },
          },
        ],
        finishReason: 'tool_calls',
      },
      { content: 'Edited.', finishReason: 'stop' },
    ];

    const runtime = new AgentRuntime({
      workspaceRoot: primary,
      objective: 'Edit shared file',
      approvalMode: 'auto-edit',
      maxTurns: 5,
      autoValidate: false,
      modelClient: new MockModelClient(responses),
      toolRegistry: registry,
      additionalRoots: [shared],
    });

    const result = await runtime.run();
    // Changed identity keeps the owning root: NOT collapsed to primary-relative.
    const changed = result.state.changedFiles.find((f) => f.relativePath === 'src/a.ts');
    assert.ok(changed, 'shared file must be tracked');
    assert.strictEqual(changed!.rootId, shared, 'identity must retain the additional root');
    assert.strictEqual(fs.readFileSync(path.join(shared, 'src', 'a.ts'), 'utf-8'), 'shared-edited');
    assert.strictEqual(fs.readFileSync(path.join(primary, 'src', 'a.ts'), 'utf-8'), 'primary-version');

    // The checkpoint for the additional-root edit restores the right file.
    const undo = await runtime.checkpoints.undo();
    assert.strictEqual(undo.ok, true);
    assert.strictEqual(fs.readFileSync(path.join(shared, 'src', 'a.ts'), 'utf-8'), 'shared-original');
    assert.strictEqual(fs.readFileSync(path.join(primary, 'src', 'a.ts'), 'utf-8'), 'primary-version');

    fs.rmSync(primary, { recursive: true, force: true });
    fs.rmSync(shared, { recursive: true, force: true });
  });

  it('rejects tool arguments that fail schema validation before execution (VCL-R3-005)', async () => {
    const registry = new ToolRegistry();
    let executed = false;
    const guardedTool: AgentTool<{ text: string }, string> = {
      name: 'guarded',
      description: 'Requires a string',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
      },
      risk: 'execute',
      async execute(input) {
        executed = true;
        return { ok: true, data: input.text };
      },
    };
    registry.register(guardedTool);

    const responses: ModelResponse[] = [
      {
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'guarded', arguments: JSON.stringify({ text: 123 }) },
          },
        ],
        finishReason: 'tool_calls',
      },
      { content: 'done', finishReason: 'stop' },
    ];

    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Trigger guarded tool',
      approvalMode: 'auto',
      maxTurns: 5,
      autoValidate: false,
      modelClient: new MockModelClient(responses),
      toolRegistry: registry,
    });

    const result = await runtime.run();
    assert.strictEqual(executed, false, 'tool must not execute on invalid arguments');
    const call = result.state.toolHistory[0];
    assert.strictEqual(call.toolName, 'guarded');
    assert.strictEqual(call.result.ok, false);
    assert.strictEqual(call.result.error?.code, 'INVALID_ARGUMENTS');
    assert.match(call.result.error?.message ?? '', /schema validation/);
  });

  it('runs parallelSafe tool calls concurrently and records them in order (VCL-R3-022)', async () => {
    const registry = new ToolRegistry();
    let entered = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const barrierTool: AgentTool<{ n: number }, number> = {
      name: 'parallel_reader',
      description: 'Reads only after every call in the batch has started',
      inputSchema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
      risk: 'read',
      parallelSafe: true,
      async execute(input) {
        entered++;
        if (entered >= 2) release();
        await gate;
        return { ok: true, data: input.n };
      },
    };
    registry.register(barrierTool);

    const responses: ModelResponse[] = [
      {
        content: '',
        toolCalls: [
          { id: 'c1', type: 'function', function: { name: 'parallel_reader', arguments: JSON.stringify({ n: 1 }) } },
          { id: 'c2', type: 'function', function: { name: 'parallel_reader', arguments: JSON.stringify({ n: 2 }) } },
        ],
        finishReason: 'tool_calls',
      },
      { content: 'done', finishReason: 'stop' },
    ];

    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Parallel reads',
      approvalMode: 'auto',
      maxTurns: 5,
      autoValidate: false,
      modelClient: new MockModelClient(responses),
      toolRegistry: registry,
    });

    // A serial runtime would deadlock on the barrier; bound the wait so a
    // regression fails fast instead of hanging CI.
    const result = await Promise.race([
      runtime.run(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('parallelSafe batch did not run concurrently (deadlock)')), 8000)
      ),
    ]);

    assert.strictEqual(entered, 2, 'both parallel-safe calls must have started');
    assert.deepStrictEqual(
      result.state.toolHistory.map((t) => (t.input as { n: number }).n),
      [1, 2],
      'tool history must preserve the original call order'
    );
    assert.ok(result.state.toolHistory.every((t) => t.result.ok));
  });

  it('keeps non-parallelSafe calls strictly ordered (VCL-R3-022)', async () => {
    const registry = new ToolRegistry();
    registry.register(shellTool);
    registry.register(readFileTool);

    const responses: ModelResponse[] = [
      {
        content: '',
        toolCalls: [
          { id: 'c1', type: 'function', function: { name: 'shell', arguments: JSON.stringify({ command: 'echo hi' }) } },
          { id: 'c2', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: 'package.json' }) } },
        ],
        finishReason: 'tool_calls',
      },
      { content: 'done', finishReason: 'stop' },
    ];

    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Ordered calls',
      approvalMode: 'auto',
      maxTurns: 5,
      autoValidate: false,
      modelClient: new MockModelClient(responses),
      toolRegistry: registry,
    });

    const result = await runtime.run();
    assert.deepStrictEqual(
      result.state.toolHistory.map((t) => t.toolName),
      ['shell', 'read_file'],
      'shell (not parallelSafe) must run before the following read, in order'
    );
  });

  it('honors project config approval mode and autoValidate (VCL-R3-010)', async () => {
    const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-project-config-')));
    fs.mkdirSync(path.join(workspace, '.venice'), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, '.venice', 'config.json'),
      JSON.stringify({ agent: { approvalMode: 'auto', autoValidate: false } })
    );
    fs.writeFileSync(
      path.join(workspace, 'package.json'),
      JSON.stringify({ name: 'test', scripts: { build: 'echo ok' } })
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

    // No approvalMode / autoValidate options: the runtime must read the
    // project config from the workspace root.
    const runtime = new AgentRuntime({
      workspaceRoot: workspace,
      objective: 'Edit',
      maxTurns: 5,
      modelClient: new MockModelClient(responses),
      toolRegistry: registry,
    });

    assert.strictEqual(runtime.getMode().permissionMode, 'auto', 'project approvalMode must be the default');
    const result = await runtime.run();
    assert.strictEqual(result.state.lastValidation, undefined, 'project autoValidate=false must disable validation');
    assert.strictEqual(result.state.changedFiles.some((f) => f.relativePath === 'hello.txt'), true);

    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('lets explicit options override project config (VCL-R3-010)', () => {
    const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-project-config-override-')));
    fs.mkdirSync(path.join(workspace, '.venice'), { recursive: true });
    fs.writeFileSync(
      path.join(workspace, '.venice', 'config.json'),
      JSON.stringify({ agent: { approvalMode: 'auto' } })
    );
    const runtime = new AgentRuntime({
      workspaceRoot: workspace,
      objective: 'Override',
      approvalMode: 'suggest',
      modelClient: new MockModelClient([]),
    });
    assert.strictEqual(runtime.getMode().permissionMode, 'suggest', 'explicit option must win over project config');
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('streams incremental deltas and persists one canonical assistant message (VCL-R3-012)', async () => {
    class StreamingMockClient extends VeniceModelClient {
      async complete(
        _messages: AgentMessage[],
        _tools: ToolDefinition[] = [],
        onDelta?: (chunk: { content?: string; reasoningContent?: string }) => void
      ): Promise<ModelResponse> {
        onDelta?.({ reasoningContent: 'thinking…' });
        onDelta?.({ content: 'Hello' });
        onDelta?.({ content: ' world' });
        return { content: 'Hello world', reasoningContent: 'thinking…', finishReason: 'stop', streamed: true };
      }
      async getModelContextLimit(): Promise<number> {
        return 128000;
      }
      async getModelProfile() {
        return undefined;
      }
    }

    const client = new StreamingMockClient({ model: 'mock' });
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Stream',
      approvalMode: 'auto-edit',
      maxTurns: 3,
      modelClient: client,
    });
    runtime.setModelProfile({ id: runtime.getState().model, mode: 'chat-only' });

    const result = await runtime.run();

    // Incremental content + reasoning surfaced as events.
    const deltas = result.events.filter((e) => e.type === 'assistant_delta').map((e) => (e as { content?: string }).content);
    assert.deepStrictEqual(deltas, ['Hello', ' world']);
    assert.ok(result.events.some((e) => e.type === 'assistant_reasoning'));

    // Exactly one canonical assistant message is persisted (no duplicate).
    const assistantMessages = runtime.getState().messages.filter((m) => m.role === 'assistant');
    assert.strictEqual(assistantMessages.length, 1);
    assert.strictEqual(assistantMessages[0].content, 'Hello world');
  });

  it('applies a conservative context limit for unknown models (VCL-R3-028)', async () => {
    class UnknownModelClient extends VeniceModelClient {
      async getModelProfile() {
        return undefined; // model not in the catalog
      }
    }
    const client = new UnknownModelClient({ model: 'mystery-model' });
    const runtime = new AgentRuntime({
      workspaceRoot: tmp,
      objective: 'Discover',
      approvalMode: 'auto-edit',
      modelClient: client,
    });
    await runtime.refreshModelProfile();
    // Fails closed to chat-only and uses a conservative budget, not 128K.
    assert.strictEqual(runtime.getState().agentMode, 'chat-only');
    assert.strictEqual(runtime.getContextManager().getMaxTokens(), UNKNOWN_CONTEXT_LIMIT);
  });
});
