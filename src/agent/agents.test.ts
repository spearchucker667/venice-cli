import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  resolveAgent,
  resolveAgentFile,
  resolvePersistedAgent,
  builtinAgentNames,
  getProjectAgentsDir,
} from './agents.js';
import { AgentRuntime } from './runtime.js';
import { VeniceModelClient } from './model-client.js';
import type { ModelResponse } from './model-client.js';
import type { AgentMessage } from './types.js';
import type { ToolDefinition } from '../types/index.js';

class NoopModelClient extends VeniceModelClient {
  async complete(_messages: AgentMessage[], _tools: ToolDefinition[] = []): Promise<ModelResponse> {
    return { content: 'done', finishReason: 'stop' };
  }
  async getModelContextLimit(): Promise<number> {
    return 128000;
  }
  async getModelProfile() {
    return undefined;
  }
}

describe('resolveAgent (VCL-R3-031)', () => {
  it('resolves the built-in default agent', () => {
    const agent = resolveAgent('default', { workspaceRoot: '/tmp' });
    assert.ok(agent);
    assert.strictEqual(agent!.name, 'default');
    assert.strictEqual(agent!.source, 'builtin');
    assert.ok(builtinAgentNames().includes('default'));
  });

  it('returns undefined for an unknown agent', () => {
    assert.strictEqual(resolveAgent('no-such-agent', { workspaceRoot: '/tmp' }), undefined);
  });

  it('resolves a project agent from .venice/agents', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-ws-'));
    const dir = getProjectAgentsDir(ws);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'senior.json'),
      JSON.stringify({
        name: 'senior',
        description: 'Senior engineer persona',
        systemPrompt: 'You are a senior staff engineer. Be concise and rigorous.',
      })
    );
    const agent = resolveAgent('senior', { workspaceRoot: ws });
    assert.ok(agent);
    assert.strictEqual(agent!.source, 'project');
    assert.strictEqual(agent!.sourcePath, path.join(dir, 'senior.json'));
    assert.ok(agent!.systemPrompt.includes('senior staff engineer'));
    fs.rmSync(ws, { recursive: true, force: true });
  });
});

describe('resolveAgentFile (VCL-R3-031)', () => {
  let dir: string;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-file-'));
  });

  it('loads a JSON definition', () => {
    const file = path.join(dir, 'agent.json');
    fs.writeFileSync(
      file,
      JSON.stringify({ name: 'reviewer', description: 'Code reviewer', systemPrompt: 'Review code strictly.', model: 'kimi-k2.5' })
    );
    const agent = resolveAgentFile(file, { workspaceRoot: dir });
    assert.ok(agent);
    assert.strictEqual(agent!.name, 'reviewer');
    assert.strictEqual(agent!.model, 'kimi-k2.5');
    assert.strictEqual(agent!.source, 'file');
  });

  it('loads a Markdown definition with frontmatter', () => {
    const file = path.join(dir, 'writer.md');
    fs.writeFileSync(
      file,
      '---\nname: writer\ndescription: Technical writer\ntools:\n  - write_file\n---\n\nYou are a meticulous technical writer.\n'
    );
    const agent = resolveAgentFile(file, { workspaceRoot: dir });
    assert.ok(agent);
    assert.strictEqual(agent!.name, 'writer');
    assert.strictEqual(agent!.description, 'Technical writer');
    assert.strictEqual(agent!.systemPrompt, 'You are a meticulous technical writer.');
    assert.strictEqual(agent!.source, 'file');
  });

  it('classifies files inside the project agents dir as project source', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-file-ws-'));
    const projectDir = getProjectAgentsDir(ws);
    fs.mkdirSync(projectDir, { recursive: true });
    const file = path.join(projectDir, 'proj-agent.json');
    fs.writeFileSync(file, JSON.stringify({ name: 'proj', systemPrompt: 'x' }));
    const agent = resolveAgentFile(file, { workspaceRoot: ws });
    assert.strictEqual(agent!.source, 'project');
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it('returns undefined for a missing file', () => {
    assert.strictEqual(resolveAgentFile(path.join(dir, 'missing.json'), { workspaceRoot: dir }), undefined);
  });
});

describe('resolvePersistedAgent (VCL-R3-031)', () => {
  it('re-resolves a builtin identity', () => {
    const agent = resolvePersistedAgent({ name: 'default', source: 'builtin' }, { workspaceRoot: '/tmp' });
    assert.ok(agent);
    assert.strictEqual(agent!.name, 'default');
  });

  it('re-resolves a file identity from its stored path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-persist-'));
    const file = path.join(dir, 'a.json');
    fs.writeFileSync(file, JSON.stringify({ name: 'a', systemPrompt: 'hello' }));
    const agent = resolvePersistedAgent({ name: 'a', source: 'file', sourcePath: file }, { workspaceRoot: dir });
    assert.ok(agent);
    assert.strictEqual(agent!.systemPrompt, 'hello');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('AgentRuntime agent integration (VCL-R3-031)', () => {
  it('applies the agent system prompt and persists identity with the session', async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-runtime-'));
    const runtime = new AgentRuntime({
      workspaceRoot: ws,
      objective: 'test',
      approvalMode: 'auto-edit',
      modelClient: new NoopModelClient(),
      agent: {
        name: 'senior',
        description: 'Senior engineer',
        systemPrompt: 'You are a senior staff engineer. Be concise.',
        source: 'project',
        sourcePath: path.join(ws, '.venice', 'agents', 'senior.json'),
      },
    });

    // Identity is persisted with the session.
    assert.deepStrictEqual(runtime.getState().agent, {
      name: 'senior',
      source: 'project',
      sourcePath: path.join(ws, '.venice', 'agents', 'senior.json'),
    });

    // The system prompt is layered into the model context.
    const systemMessage = runtime.getContextManager().buildMessages()[0];
    assert.ok(String(systemMessage.content).includes('You are a senior staff engineer. Be concise.'));
    fs.rmSync(ws, { recursive: true, force: true });
  });
});
