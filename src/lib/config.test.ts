import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  loadProjectConfig,
  validateConfigShape,
  getApiKey,
  getFallbackApiKey,
  getFallbackVeniceAuth,
} from './config.js';

describe('validateConfigShape (P2 config schema)', () => {
  it('accepts a well-formed config', () => {
    assert.deepStrictEqual(
      validateConfigShape({
        api_key: 'vnc_x',
        fallback_api_key: 'vnc_y',
        default_model: 'kimi-k2-5',
        output_format: 'json',
        no_color: true,
        theme: 'dracula',
      }),
      []
    );
  });

  it('rejects wrong types and invalid enum values', () => {
    const problems = validateConfigShape({
      no_color: 'yes',
      output_format: 'xml',
      show_usage: 1,
    });
    assert.ok(problems.some((p) => p.includes('no_color')), problems.join('; '));
    assert.ok(problems.some((p) => p.includes('output_format')), problems.join('; '));
    assert.ok(problems.some((p) => p.includes('show_usage')), problems.join('; '));
  });

  it('rejects a non-string fallback_api_key', () => {
    const problems = validateConfigShape({ fallback_api_key: 42 });
    assert.ok(problems.some((p) => p.includes('fallback_api_key')), problems.join('; '));
  });

  it('rejects a non-object config', () => {
    assert.ok(validateConfigShape('nope').length > 0);
    assert.ok(validateConfigShape([1, 2]).length > 0);
  });

  it('allows unknown keys so a future field never bricks an older CLI', () => {
    assert.deepStrictEqual(validateConfigShape({ future_field: 'x', no_color: false }), []);
  });
});

describe('loadProjectConfig (VCL-R3-010)', () => {
  let tmp: string;

  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-project-config-')));
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns {} when no project config exists', () => {
    assert.deepStrictEqual(loadProjectConfig(tmp), {});
  });

  it('reads agent approval/validation and context compaction settings', () => {
    const venice = path.join(tmp, '.venice');
    fs.mkdirSync(venice, { recursive: true });
    fs.writeFileSync(
      path.join(venice, 'config.json'),
      JSON.stringify({
        agent: { approvalMode: 'auto-edit', autoValidate: false },
        context: { autoCompact: false },
      })
    );
    assert.deepStrictEqual(loadProjectConfig(tmp), {
      agent: { approvalMode: 'auto-edit', autoValidate: false },
      context: { autoCompact: false },
    });
  });

  it('never exposes auth secrets from a project config', () => {
    const venice = path.join(tmp, '.venice');
    fs.mkdirSync(venice, { recursive: true });
    fs.writeFileSync(
      path.join(venice, 'config.json'),
      JSON.stringify({
        api_key: 'vnc_super_secret',
        signInWithX: 'wallet-token-secret',
        agent: { approvalMode: 'suggest' },
      })
    );
    const config = loadProjectConfig(tmp);
    assert.strictEqual((config as Record<string, unknown>).api_key, undefined);
    assert.strictEqual((config as Record<string, unknown>).signInWithX, undefined);
    assert.deepStrictEqual(config.agent, { approvalMode: 'suggest' });
  });

  it('ignores malformed values and unknown sections', () => {
    const venice = path.join(tmp, '.venice');
    fs.mkdirSync(venice, { recursive: true });
    fs.writeFileSync(
      path.join(venice, 'config.json'),
      JSON.stringify({
        agent: { approvalMode: 'turbo', autoValidate: 'yes' },
        context: { autoCompact: 1 },
        random: true,
      })
    );
    assert.deepStrictEqual(loadProjectConfig(tmp), {});
  });

  it('returns {} for malformed JSON and symlinked config files', () => {
    const venice = path.join(tmp, '.venice');
    fs.mkdirSync(venice, { recursive: true });
    fs.writeFileSync(path.join(venice, 'config.json'), '{ not json');
    assert.deepStrictEqual(loadProjectConfig(tmp), {});

    fs.rmSync(path.join(venice, 'config.json'));
    const outside = path.join(tmp, 'outside-config.json');
    fs.writeFileSync(outside, JSON.stringify({ agent: { approvalMode: 'auto' } }));
    try {
      fs.symlinkSync(outside, path.join(venice, 'config.json'));
    } catch {
      // Symlinks unsupported on this platform — nothing else to assert.
      return;
    }
    assert.deepStrictEqual(loadProjectConfig(tmp), {});
  });
});

describe('fallback API key resolution (env-only, no config writes)', () => {
  const savedKey = process.env.VENICE_API_KEY;
  const savedFallback = process.env.VENICE_API_KEY_FALLBACK;

  after(() => {
    if (savedKey === undefined) delete process.env.VENICE_API_KEY;
    else process.env.VENICE_API_KEY = savedKey;
    if (savedFallback === undefined) delete process.env.VENICE_API_KEY_FALLBACK;
    else process.env.VENICE_API_KEY_FALLBACK = savedFallback;
  });

  it('prefers the primary env key over the fallback env key', () => {
    process.env.VENICE_API_KEY = 'primary';
    process.env.VENICE_API_KEY_FALLBACK = 'fallback';
    assert.strictEqual(getApiKey(), 'primary');
  });

  it('reads the fallback key from its env var', () => {
    process.env.VENICE_API_KEY = 'primary';
    process.env.VENICE_API_KEY_FALLBACK = 'fallback';
    assert.strictEqual(getFallbackApiKey(), 'fallback');
  });

  it('getFallbackVeniceAuth returns the fallback credential when it differs from the active key', () => {
    process.env.VENICE_API_KEY = 'primary';
    process.env.VENICE_API_KEY_FALLBACK = 'fallback';
    assert.deepStrictEqual(getFallbackVeniceAuth(), { kind: 'api-key', value: 'fallback' });
  });

  it('getFallbackVeniceAuth returns undefined when the fallback equals the active key', () => {
    process.env.VENICE_API_KEY = 'same-key';
    process.env.VENICE_API_KEY_FALLBACK = 'same-key';
    assert.strictEqual(getFallbackVeniceAuth(), undefined);
  });
});
