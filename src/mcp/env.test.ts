import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildMcpEnv, expandEnvReferences, SAFE_MCP_ENV_KEYS } from './env.js';

function withEnv(key: string, value: string | undefined, fn: () => void): void {
  const previous = process.env[key];
  try {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
    fn();
  } finally {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
}

describe('buildMcpEnv', () => {
  it('does not propagate credential variables by default', () => {
    withEnv('VENICE_API_KEY', 'secret-1', () => {
      withEnv('X_SIGN_IN_WITH_X', 'secret-2', () => {
        withEnv('GITHUB_TOKEN', 'secret-3', () => {
          withEnv('GH_TOKEN', 'secret-4', () => {
            withEnv('AWS_SECRET_ACCESS_KEY', 'secret-5', () => {
              const env = buildMcpEnv();
              assert.strictEqual(env.VENICE_API_KEY, undefined);
              assert.strictEqual(env.X_SIGN_IN_WITH_X, undefined);
              assert.strictEqual(env.GITHUB_TOKEN, undefined);
              assert.strictEqual(env.GH_TOKEN, undefined);
              assert.strictEqual(env.AWS_SECRET_ACCESS_KEY, undefined);
            });
          });
        });
      });
    });
  });

  it('propagates only allowlisted safe variables', () => {
    withEnv('PATH', '/usr/bin:/bin', () => {
      withEnv('HOME', '/home/test', () => {
        withEnv('CUSTOM_THING', 'should-not-leak', () => {
          const env = buildMcpEnv();
          assert.strictEqual(env.PATH, '/usr/bin:/bin');
          assert.strictEqual(env.HOME, '/home/test');
          assert.strictEqual(env.CUSTOM_THING, undefined);
          for (const key of Object.keys(env)) {
            assert.ok(
              SAFE_MCP_ENV_KEYS.includes(key as (typeof SAFE_MCP_ENV_KEYS)[number]),
              `unexpected variable propagated: ${key}`
            );
          }
        });
      });
    });
  });

  it('applies explicit config env entries', () => {
    const env = buildMcpEnv({ MCP_TEST_EXPLICIT: 'bar' });
    assert.strictEqual(env.MCP_TEST_EXPLICIT, 'bar');
  });

  it('expands ${env:VAR} references as an explicit opt-in', () => {
    withEnv('MCP_TEST_PARENT_VAR', 'explicit-value', () => {
      const env = buildMcpEnv({ CHILD_VAR: '${env:MCP_TEST_PARENT_VAR}' });
      assert.strictEqual(env.CHILD_VAR, 'explicit-value');
    });
  });

  it('leaves unresolvable references untouched', () => {
    const env = buildMcpEnv({ CHILD_VAR: '${env:MCP_TEST_MISSING_VAR_12345}' });
    assert.strictEqual(env.CHILD_VAR, '${env:MCP_TEST_MISSING_VAR_12345}');
  });
});

describe('expandEnvReferences', () => {
  it('resolves only ${env:NAME} syntax', () => {
    withEnv('MCP_TEST_REF', 'value', () => {
      assert.strictEqual(expandEnvReferences('a-${env:MCP_TEST_REF}-b'), 'a-value-b');
      assert.strictEqual(expandEnvReferences('no references'), 'no references');
      assert.strictEqual(expandEnvReferences('$MCP_TEST_REF'), '$MCP_TEST_REF');
    });
  });
});
