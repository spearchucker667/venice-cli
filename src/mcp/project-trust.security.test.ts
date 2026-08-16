import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { McpManager } from './manager.js';
import { mergeMcpConfigs } from './config.js';
import { WorkspaceTrustStore, resolveProjectMcpTrust } from './trust.js';

// Tests run from the project root via `npm test`.
const fixture = path.join(process.cwd(), 'src/mcp/test-server-inspect.js');

interface FakeRepo {
  repo: string;
  marker: string;
  configPath: string;
}

function makeRepo(): FakeRepo {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-trust-spawn-'));
  const marker = path.join(repo, 'marker.txt');
  fs.mkdirSync(path.join(repo, '.venice'), { recursive: true });
  const configPath = path.join(repo, '.venice', 'mcp.json');
  const server = {
    command: 'node',
    args: [fixture],
    env: { START_MARKER_FILE: marker },
  };
  fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { inspect: server } }));
  return { repo, marker, configPath };
}

function isolatedStore(repo: string): WorkspaceTrustStore {
  return new WorkspaceTrustStore(path.join(repo, 'trust-store.json'));
}

async function startAndStop(mcpServers: Record<string, unknown>): Promise<{
  manager: McpManager;
  serverNames: string[];
  errors: (string | undefined)[];
}> {
  const manager = new McpManager({ mcpServers } as never);
  await manager.start();
  const states = manager.getServerStates();
  const snapshot = {
    manager,
    serverNames: states.map((s) => s.name),
    errors: states.map((s) => s.error),
  };
  await manager.stop();
  return snapshot;
}

describe('VC-KIMI-001: project MCP config is not auto-executed without trust', () => {
  it('does not spawn project MCP before approval, runs after approval, and invalidates on config change', async () => {
    const { repo, marker, configPath } = makeRepo();
    const store = isolatedStore(repo);

    // 1. Start without trust => marker MUST NOT exist.
    const untrusted = await resolveProjectMcpTrust({
      workspaceRoot: repo,
      configPath,
      interactive: false,
      store,
    });
    assert.strictEqual(untrusted.status, 'skipped');
    await startAndStop(mergeMcpConfigs({ mcpServers: {} }, untrusted.config).mcpServers);
    assert.strictEqual(
      fs.existsSync(marker),
      false,
      'project MCP executable must not run before trust approval'
    );

    // 2. Approve the exact config hash => start => marker exists.
    const approved = await resolveProjectMcpTrust({
      workspaceRoot: repo,
      configPath,
      interactive: true,
      store,
      confirm: () => Promise.resolve(true),
    });
    assert.strictEqual(approved.status, 'approved');
    const started = await startAndStop(mergeMcpConfigs({ mcpServers: {} }, approved.config).mcpServers);
    assert.ok(fs.existsSync(marker), 'project MCP executable must run after approval');
    assert.deepStrictEqual(started.serverNames, ['inspect']);
    assert.strictEqual(started.errors[0], undefined, 'fixture server should start cleanly');

    // 3. Modify mcp.json => trust invalid => executable must NOT run again.
    const mtimeBefore = fs.statSync(marker).mtimeMs;
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          inspect: {
            command: 'node',
            args: [fixture],
            env: { START_MARKER_FILE: marker },
            disabled: false,
          },
        },
      })
    );
    const changed = await resolveProjectMcpTrust({
      workspaceRoot: repo,
      configPath,
      interactive: false,
      store,
    });
    assert.strictEqual(changed.status, 'skipped');
    assert.strictEqual(changed.reason, 'config-changed');
    await startAndStop(mergeMcpConfigs({ mcpServers: {} }, changed.config).mcpServers);
    assert.strictEqual(
      fs.statSync(marker).mtimeMs,
      mtimeBefore,
      'project MCP executable must not re-run after the config changed'
    );
  });

  it('keeps a global server while skipping an untrusted project server', async () => {
    const { repo, configPath } = makeRepo();
    const store = isolatedStore(repo);
    const globalMarker = path.join(repo, 'global-marker.txt');

    const untrusted = await resolveProjectMcpTrust({
      workspaceRoot: repo,
      configPath,
      interactive: false,
      store,
    });
    assert.strictEqual(untrusted.status, 'skipped');

    const started = await startAndStop({
      global: {
        command: 'node',
        args: [fixture],
        env: { START_MARKER_FILE: globalMarker },
      },
      ...untrusted.config.mcpServers,
    });
    assert.deepStrictEqual(started.serverNames, ['global']);
    assert.ok(fs.existsSync(globalMarker), 'global server runs');
    assert.strictEqual(fs.existsSync(path.join(repo, 'marker.txt')), false, 'project server does not run');
  });
});
