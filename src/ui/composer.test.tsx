import { describe, it } from 'node:test';
import assert from 'node:assert';
import { render } from 'ink-testing-library';
import { Composer, findMentionCompletions, loadComposerHistory, persistComposerHistory } from './composer.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

describe('Composer', () => {
  it('renders an input prompt', () => {
    const { lastFrame } = render(<Composer workspaceRoot={process.cwd()} onSubmit={() => {}} />);
    assert.ok(lastFrame()?.includes('>'));
  });

  it('submits trimmed text', async () => {
    let submitted = false;
    const { stdin, lastFrame } = render(<Composer onSubmit={(text) => {
      assert.strictEqual(text, 'hello');
      submitted = true;
    }} workspaceRoot={process.cwd()} />);
    stdin.write('hello');
    await new Promise(r => setTimeout(r, 50));
    assert.ok(lastFrame()?.includes('hello'));
    stdin.write('\r');
    await new Promise(r => setTimeout(r, 50));
    assert.ok(submitted);
  });

  it('uses nested workspace-rooted autocomplete without ignored directories', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'venice-composer-'));
    try {
      await fs.mkdir(path.join(root, 'src', 'agent'), { recursive: true });
      await fs.writeFile(path.join(root, 'src', 'api.ts'), '');
      await fs.mkdir(path.join(root, 'src', 'node_modules'));
      assert.deepStrictEqual(await findMentionCompletions(root, 'src/a'), ['src/agent/', 'src/api.ts']);
      assert.deepStrictEqual(await findMentionCompletions(root, '../'), []);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('matches git-tracked files across path components (VC-KIMI-050)', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'venice-composer-git-'));
    try {
      const { execFileSync } = await import('node:child_process');
      await fs.mkdir(path.join(root, 'src', 'agent'), { recursive: true });
      await fs.writeFile(path.join(root, 'src', 'agent', 'runtime.ts'), '');
      execFileSync('git', ['init', '-q'], { cwd: root });
      execFileSync('git', ['add', '-A'], { cwd: root });
      // Substring match on a deep path component, not just a leaf prefix.
      assert.ok((await findMentionCompletions(root, 'runt')).includes('src/agent/runtime.ts'));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('persists composer history across processes (VC-KIMI-052)', async () => {
    const previousHome = process.env.HOME;
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'venice-composer-home-'));
    process.env.HOME = tempHome;
    try {
      persistComposerHistory(['first', 'second']);
      assert.deepStrictEqual(loadComposerHistory(), ['first', 'second']);
      persistComposerHistory(['third', 'first', 'second']);
      assert.deepStrictEqual(loadComposerHistory(), ['third', 'first', 'second']);
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      await fs.rm(tempHome, { recursive: true, force: true });
    }
  });
});
