import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  CONFIG_KEY_METADATA,
  DEFAULT_MODELS,
  X_SIGN_IN_WITH_X_HEADER,
  applyVeniceAuth,
  isConfigKey,
  isSecretConfigKey,
  maskSecretValue,
} from './config.js';
import { modelUsdPrice } from '../types/index.js';
import type { Model } from '../types/index.js';

function withTempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'venice-auth-test-'));
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  return dir;
}

test('X_SIGN_IN_WITH_X_HEADER uses the documented x402 header name', () => {
  assert.equal(X_SIGN_IN_WITH_X_HEADER, 'X-Sign-In-With-X');
});

function runConfigProbe(
  homeDir: string,
  extraEnv: Record<string, string> = {}
): { auth: unknown; threw: boolean } {
  const configUrl = new URL('./config.js', import.meta.url).href;
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
  };
  delete env.VENICE_API_KEY;
  delete env.X_SIGN_IN_WITH_X;
  for (const [key, value] of Object.entries(extraEnv)) {
    env[key] = value;
  }

  const script = `
    import { getVeniceAuth, requireAuth } from ${JSON.stringify(configUrl)};
    const auth = getVeniceAuth() ?? null;
    let threw = false;
    try { requireAuth(); } catch { threw = true; }
    console.log(JSON.stringify({ auth, threw }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as { auth: unknown; threw: boolean };
}

test('getVeniceAuth prefers API key over x402 and falls back', () => {
  const home = withTempHome();
  try {
    const none = runConfigProbe(home);
    assert.equal(none.auth, null);

    const x402 = runConfigProbe(home, { X_SIGN_IN_WITH_X: 'wallet-token' });
    assert.deepEqual(x402.auth, { kind: 'sign-in-with-x', value: 'wallet-token' });

    const both = runConfigProbe(home, {
      VENICE_API_KEY: 'sk-test',
      X_SIGN_IN_WITH_X: 'wallet-token',
    });
    assert.deepEqual(both.auth, { kind: 'api-key', value: 'sk-test' });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('applyVeniceAuth emits the correct header per auth kind', () => {
  const apiKeyHeaders: Record<string, string> = {};
  applyVeniceAuth(apiKeyHeaders, { kind: 'api-key', value: 'sk-test' });
  assert.equal(apiKeyHeaders.Authorization, 'Bearer sk-test');
  assert.equal(apiKeyHeaders[X_SIGN_IN_WITH_X_HEADER], undefined);

  const x402Headers: Record<string, string> = {};
  applyVeniceAuth(x402Headers, { kind: 'sign-in-with-x', value: 'wallet-token' });
  assert.equal(x402Headers[X_SIGN_IN_WITH_X_HEADER], 'wallet-token');
  assert.equal(x402Headers.Authorization, undefined);
});

test('requireAuth throws when no auth is configured', () => {
  const home = withTempHome();
  try {
    const probe = runConfigProbe(home);
    assert.equal(probe.threw, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('config key registry marks both secrets and drives masking', () => {
  assert.equal(isConfigKey('api_key'), true);
  assert.equal(isConfigKey('signInWithX'), true);
  assert.equal(isConfigKey('default_model'), true);
  assert.equal(isConfigKey('not-a-key'), false);

  assert.equal(isSecretConfigKey('api_key'), true);
  assert.equal(isSecretConfigKey('signInWithX'), true);
  assert.equal(isSecretConfigKey('default_model'), false);

  assert.equal(CONFIG_KEY_METADATA.signInWithX.secret, true);
  assert.equal(CONFIG_KEY_METADATA.api_key.secret, true);

  assert.equal(maskSecretValue('short'), '****');
  assert.equal(maskSecretValue('sk-test-1234567890'), 'sk-t...7890');
});

test('DEFAULT_MODELS centralizes direct API model IDs', () => {
  assert.equal(DEFAULT_MODELS.chat, 'kimi-k2-5');
  assert.equal(DEFAULT_MODELS.image, 'flux-2-pro');
  assert.equal(DEFAULT_MODELS.embedding, 'text-embedding-3-small');
  assert.equal(DEFAULT_MODELS.transcription, 'nvidia/parakeet-tdt-0.6b-v3');
});

test('modelUsdPrice sums input/output USD pricing', () => {
  const tokenModel: Model = {
    id: 'token-model',
    model_spec: {
      pricing: {
        input: { usd: 0.7, diem: 7 },
        output: { usd: 2.8, diem: 28 },
      },
    },
  };
  assert.equal(modelUsdPrice(tokenModel), 3.5);

  const noPricing: Model = { id: 'free-model' };
  assert.equal(modelUsdPrice(noPricing), undefined);

  const imageModel: Model = {
    id: 'image-model',
    model_spec: {
      pricing: {
        base: { usd: 0.03 },
      },
    },
  };
  assert.equal(modelUsdPrice(imageModel), undefined);
});
