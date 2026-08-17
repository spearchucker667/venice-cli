import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadProjectConfig } from './config.js';

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
