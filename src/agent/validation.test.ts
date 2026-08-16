import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { detectValidationCommands } from './validation.js';

describe('detectValidationCommands', () => {
  let tmp: string;

  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-validation-test-')));
  });

  it('detects npm scripts from package.json', async () => {
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest', build: 'tsc', lint: 'eslint' } })
    );
    const commands = await detectValidationCommands(tmp);
    const commandStrings = commands.map((c) => c.command);
    assert.ok(commandStrings.includes('npm run lint'));
    assert.ok(commandStrings.includes('npm run test'));
    assert.ok(commandStrings.includes('npm run build'));
  });

  it('detects Python projects', async () => {
    fs.writeFileSync(path.join(tmp, 'requirements.txt'), 'requests\n');
    const commands = await detectValidationCommands(tmp);
    assert.ok(commands.some((c) => c.command === 'pytest'));
  });

  it('detects Rust projects', async () => {
    fs.writeFileSync(path.join(tmp, 'Cargo.toml'), '[package]\n');
    const commands = await detectValidationCommands(tmp);
    assert.ok(commands.some((c) => c.command === 'cargo test'));
  });

  it('detects Go projects', async () => {
    fs.writeFileSync(path.join(tmp, 'go.mod'), 'module example\n');
    const commands = await detectValidationCommands(tmp);
    assert.ok(commands.some((c) => c.command === 'go test ./...'));
  });
});
