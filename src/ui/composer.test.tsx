import { describe, it } from 'node:test';
import assert from 'node:assert';
import { render } from 'ink-testing-library';
import { Composer, findMentionCompletions } from './composer.js';
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
});
