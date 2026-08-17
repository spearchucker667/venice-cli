import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadInstructions, instructionsForPath, instructionsForPaths, isScopedRule } from './instructions.js';

describe('loadInstructions', () => {
  let tmp: string;

  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-instructions-test-')));
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('includes built-in contract', async () => {
    const result = await loadInstructions(tmp);
    assert.ok(result.text.includes('Venice Agent'));
    assert.ok(result.sources.some((s) => s.source === 'built-in'));
  });

  it('loads repository instructions', async () => {
    fs.writeFileSync(path.join(tmp, 'AGENTS.md'), 'Use TypeScript strict mode.\n');
    const result = await loadInstructions(tmp);
    assert.ok(result.text.includes('TypeScript strict mode'));
    assert.ok(result.sources.some((s) => s.source === 'AGENTS.md'));
  });

  it('loads .venice/instructions.md', async () => {
    fs.mkdirSync(path.join(tmp, '.venice'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.venice', 'instructions.md'), 'Prefer minimal edits.\n');
    const result = await loadInstructions(tmp);
    assert.ok(result.text.includes('Prefer minimal edits'));
  });

  it('loads nested rules scoped to paths without promoting them globally (VCL-017)', async () => {
    fs.mkdirSync(path.join(tmp, '.venice', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.venice', 'rules', 'src.md'), 'Follow src conventions.\n');
    const result = await loadInstructions(tmp);
    // Scoped rules stay out of the global text and are resolved per-path.
    assert.ok(!result.text.includes('src conventions'));
    assert.ok(result.sources.some((s) => isScopedRule(s) && s.content.includes('src conventions')));
    assert.ok(instructionsForPath(result, 'src/app.ts').includes('src conventions'));
  });

  it('filters nested rules by target path', async () => {
    fs.mkdirSync(path.join(tmp, '.venice', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.venice', 'rules', 'src.md'), 'SRC ONLY\n');
    fs.writeFileSync(path.join(tmp, '.venice', 'rules', 'tests.md'), 'TESTS ONLY\n');
    const result = await loadInstructions(tmp);
    const srcScoped = instructionsForPath(result, 'src/app.ts');
    assert.ok(srcScoped.includes('SRC ONLY'));
    assert.ok(!srcScoped.includes('TESTS ONLY'));
  });

  it('unions scoped rules across multiple target paths without global leakage', async () => {
    fs.mkdirSync(path.join(tmp, '.venice', 'rules'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.venice', 'rules', 'src.md'), 'SRC ONLY\n');
    fs.writeFileSync(path.join(tmp, '.venice', 'rules', 'tests.md'), 'TESTS ONLY\n');
    const result = await loadInstructions(tmp);
    const union = instructionsForPaths(result, ['src/app.ts', 'tests/unit.ts']);
    assert.ok(union.includes('SRC ONLY'));
    assert.ok(union.includes('TESTS ONLY'));
    // Global/unscoped instructions are not duplicated in the per-path union.
    assert.ok(!union.includes('Venice Agent'));
  });
});
