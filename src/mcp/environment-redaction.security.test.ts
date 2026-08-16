import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { McpManager } from './manager.js';

// Tests run from the project root via `npm test`.
const fixture = path.join(process.cwd(), 'src/mcp/test-server-inspect.js');

function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return fn().finally(() => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

async function dumpChildEnv(configEnv: Record<string, string>): Promise<Record<string, string>> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-env-dump-'));
  const outFile = path.join(dir, 'env.json');
  const manager = new McpManager({
    mcpServers: {
      inspect: {
        command: 'node',
        args: [fixture],
        env: { INSPECT_OUT_FILE: outFile, ...configEnv },
      },
    },
  });
  await manager.start();
  await manager.stop();
  const raw = fs.readFileSync(outFile, 'utf-8');
  return JSON.parse(raw) as Record<string, string>;
}

describe('VC-KIMI-002: MCP children do not inherit parent credentials', () => {
  it('excludes API keys, tokens, and unrelated variables by default', async () => {
    await withEnv(
      {
        VENICE_API_KEY: 'venice-secret-1',
        X_SIGN_IN_WITH_X: 'siwx-secret-2',
        GH_TOKEN: 'gh-secret-3',
        GITHUB_TOKEN: 'github-secret-4',
        OPENAI_API_KEY: 'openai-secret-5',
        ANTHROPIC_API_KEY: 'anthropic-secret-6',
        SAFE_TEST: 'safe-value',
      },
      async () => {
        const childEnv = await dumpChildEnv({});
        assert.strictEqual(childEnv.VENICE_API_KEY, undefined);
        assert.strictEqual(childEnv.X_SIGN_IN_WITH_X, undefined);
        assert.strictEqual(childEnv.GH_TOKEN, undefined);
        assert.strictEqual(childEnv.GITHUB_TOKEN, undefined);
        assert.strictEqual(childEnv.OPENAI_API_KEY, undefined);
        assert.strictEqual(childEnv.ANTHROPIC_API_KEY, undefined);
        assert.strictEqual(childEnv.SAFE_TEST, undefined);
      }
    );
  });

  it('propagates a parent value only when explicitly interpolated', async () => {
    await withEnv({ GITHUB_TOKEN: 'gh-secret-3' }, async () => {
      const childEnv = await dumpChildEnv({ GITHUB_TOKEN: '${env:GITHUB_TOKEN}' });
      assert.strictEqual(childEnv.GITHUB_TOKEN, 'gh-secret-3');
    });
  });

  it('does not leak the same credential when the config value is static', async () => {
    await withEnv({ GITHUB_TOKEN: 'gh-secret-3' }, async () => {
      const childEnv = await dumpChildEnv({ GITHUB_TOKEN: 'static-value' });
      assert.strictEqual(childEnv.GITHUB_TOKEN, 'static-value');
      assert.ok(!JSON.stringify(childEnv).includes('gh-secret-3'));
    });
  });

  it('still provides safe runtime variables such as PATH', async () => {
    const childEnv = await dumpChildEnv({});
    assert.ok(childEnv.PATH !== undefined, 'PATH is needed to resolve executables');
    assert.strictEqual(childEnv.PATH, process.env.PATH);
  });
});
