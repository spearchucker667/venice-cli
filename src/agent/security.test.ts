import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionManager } from './sessions.js';
import type { AgentState } from './types.js';
import type { AgentEvent } from './events.js';
import { AgentRuntime } from './runtime.js';
import { PermissionManager } from './permissions.js';
import { ToolRegistry } from '../tools/registry.js';
import { editFileTool } from '../tools/filesystem/edit.js';
import { VeniceModelClient } from './model-client.js';
import type { ModelResponse } from './model-client.js';
import type { AgentMessage } from './types.js';
import type { ToolDefinition } from '../types/index.js';
import type { ModelProfile } from './model-profile.js';

/** Minimal headless model client: replays canned responses in order. */
class HeadlessEditModelClient extends VeniceModelClient {
  private callCount = 0;

  constructor(private readonly responses: ModelResponse[]) {
    super({ model: 'mock' });
  }

  async complete(_messages: AgentMessage[], _tools: ToolDefinition[] = []): Promise<ModelResponse> {
    return this.responses[this.callCount++] ?? { content: 'done', finishReason: 'stop' };
  }

  async getModelContextLimit(): Promise<number> {
    return 128000;
  }

  async getModelProfile(): Promise<ModelProfile | undefined> {
    return undefined;
  }
}

describe('Security and Secret Redaction', () => {
  let tmp: string;
  let manager: SessionManager;

  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-security-test-')));
    // Initialize SessionManager with known secrets to test the Redactor integration
    process.env.VENICE_API_KEY = 'vnc_dummy_api_key_for_testing';
    manager = new SessionManager(tmp);
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    delete process.env.VENICE_API_KEY;
  });

  const state = (id: string, messages: any[]): AgentState => ({
    sessionId: id,
    workspaceRoot: '/tmp',
    workspace: { primaryRoot: '/tmp', additionalRoots: [] },
    model: 'test',
    objective: 'test',
    status: 'idle',
    mode: { inputMode: 'agent', operatingMode: 'agent', permissionMode: 'suggest' },
    messages,
    todos: [],
    relevantFiles: [],
    changedFiles: [],
    toolHistory: [],
    skillSummaries: [],
    activeSkills: [],
  });

  it('redacts tokens from messages when saving to session.json', () => {
    const id = 's-redact-1';
    const testState = state(id, [
      { role: 'user', content: 'Here is my token: vnc_dummy_api_key_for_testing' },
      { role: 'assistant', content: 'I should not echo Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy.signature back' }
    ]);

    manager.save(testState, []);
    
    // Load directly from file system to verify what was actually written
    const sessionPath = path.join(tmp, id, 'session.json');
    const diskContent = fs.readFileSync(sessionPath, 'utf-8');
    
    assert.strictEqual(diskContent.includes('vnc_dummy_api_key_for_testing'), false, 'Known secret leaked into session.json');
    assert.strictEqual(diskContent.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy.signature'), false, 'JWT leaked into session.json');
    assert.strictEqual(diskContent.includes('***REDACTED***'), true, 'Redaction marker missing from session.json');

    // Also check the jsonl projections
    const messagesPath = path.join(tmp, id, 'messages.jsonl');
    const messagesContent = fs.readFileSync(messagesPath, 'utf-8');
    assert.strictEqual(messagesContent.includes('vnc_dummy_api_key_for_testing'), false, 'Known secret leaked into messages.jsonl');
  });

  it('redacts tokens from tool events', () => {
    const id = 's-redact-2';
    const events: AgentEvent[] = [
      {
        type: 'tool_completed',
        timestamp: new Date().toISOString(),
        eventId: 'e1',
        toolName: 'run_command',
        input: 'curl -H "Authorization: Bearer super-secret-token-1234567890" https://api.venice.ai/v1/models',
        result: 'Success'
      }
    ];

    manager.save(state(id, []), events);
    
    // Load directly from file system
    const sessionPath = path.join(tmp, id, 'session.json');
    const diskContent = fs.readFileSync(sessionPath, 'utf-8');
    
    assert.strictEqual(diskContent.includes('super-secret-token-1234567890'), false, 'Tool input token leaked into session.json');
    assert.strictEqual(diskContent.includes('***REDACTED***'), true, 'Redaction marker missing from tool input in session.json');

    const eventsPath = path.join(tmp, id, 'events.jsonl');
    const eventsContent = fs.readFileSync(eventsPath, 'utf-8');
    assert.strictEqual(eventsContent.includes('super-secret-token-1234567890'), false, 'Tool input token leaked into events.jsonl');
  });
});

describe('Headless auto-validation execution trust (VCL-R3-001)', () => {
  let workspace: string;
  let marker: string;

  before(() => {
    workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-validation-trust-')));
    marker = path.join(os.tmpdir(), `venice-validation-pwned-${process.pid}-${Date.now()}`);
    fs.writeFileSync(
      path.join(workspace, 'package.json'),
      JSON.stringify({
        name: 'untrusted',
        scripts: {
          // Repository-controlled "validation" that would write outside the repo.
          test: `node -e "require('fs').writeFileSync(process.env.VENICE_VALIDATION_MARKER,'1')"`,
        },
      })
    );
    fs.writeFileSync(path.join(workspace, 'README.md'), '# Untrusted\n');
  });

  after(() => {
    delete process.env.VENICE_VALIDATION_MARKER;
    fs.rmSync(workspace, { recursive: true, force: true });
    if (fs.existsSync(marker)) {
      fs.rmSync(marker, { force: true });
    }
  });

  it('auto-edit proceeds, but repository-controlled validation is denied without execution trust', async () => {
    process.env.VENICE_VALIDATION_MARKER = marker;

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
              arguments: JSON.stringify({ path: 'README.md', oldString: '# Untrusted', newString: '# Trusted' }),
            },
          },
        ],
        finishReason: 'tool_calls',
      },
      { content: 'Edit applied.', finishReason: 'stop' },
    ];

    // Headless default is auto-edit with no approver installed.
    const runtime = new AgentRuntime({
      workspaceRoot: workspace,
      objective: 'Update the README title',
      approvalMode: 'auto-edit',
      maxTurns: 5,
      modelClient: new HeadlessEditModelClient(responses),
      toolRegistry: registry,
      permissionManager: new PermissionManager('auto-edit'),
    });

    const result = await runtime.run();

    // The edit itself proceeds under auto-edit.
    assert.strictEqual(result.state.status, 'complete');
    assert.ok(result.state.changedFiles.some((f) => f.relativePath === 'README.md'), 'edit must be allowed under auto-edit');
    assert.match(fs.readFileSync(path.join(workspace, 'README.md'), 'utf-8'), /# Trusted/);

    // Validation is attempted and denied without workspace execution trust.
    assert.ok(result.state.lastValidation, 'validation must have been attempted after the edit');
    assert.strictEqual(result.state.lastValidation!.overallSuccess, false);
    const denied = result.state.lastValidation!.commands.find((c) => c.command === 'npm run test');
    assert.ok(denied, 'validation must have attempted npm run test');
    assert.strictEqual(denied!.exitCode, -1, 'denied validation must not execute');
    assert.match(denied!.stderr, /denied/i);

    // The repository-controlled script never ran.
    assert.strictEqual(
      fs.existsSync(marker),
      false,
      'repository-controlled validation script must not execute without execution trust'
    );
  });
});
