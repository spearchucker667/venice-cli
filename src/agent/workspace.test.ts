import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { WorkspaceManager, detectGitRoot } from './workspace.js';
import { ChangeLedger } from './change-ledger.js';

describe('WorkspaceManager', () => {
  let tmp: string;
  let workspace: WorkspaceManager;

  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-workspace-test-')));
    fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src', 'app.ts'), 'console.log("hello");\n');
    workspace = new WorkspaceManager(tmp);
  });

  it('resolves a relative file inside workspace', () => {
    const resolved = workspace.resolve('src/app.ts');
    assert.strictEqual(resolved.relative, 'src/app.ts');
    assert.ok(resolved.absolute.startsWith(tmp));
  });

  it('rejects path traversal', () => {
    assert.throws(() => workspace.resolve('../secret.txt'), /outside workspace/);
  });

  it('rejects absolute external paths', () => {
    assert.throws(() => workspace.resolve('/etc/passwd'), /outside workspace/);
  });

  it('rejects external home paths like ssh keys', () => {
    assert.throws(() => workspace.resolve(path.join(os.homedir(), '.ssh', 'id_ed25519')), /outside workspace/);
  });

  it('rejects symlinks escaping workspace', () => {
    const external = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-external-')));
    const secret = path.join(external, 'secret.txt');
    fs.writeFileSync(secret, 'secret');
    const link = path.join(tmp, 'escape.txt');
    fs.symlinkSync(secret, link);
    assert.throws(() => workspace.resolve('escape.txt'), /outside workspace/);
  });

  it('detects binary files', () => {
    const binPath = path.join(tmp, 'logo.png');
    fs.writeFileSync(binPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]));
    assert.strictEqual(workspace.isBinaryFile(binPath), true);
  });

  it('tracks changed files as root-aware refs', () => {
    const ledger = new ChangeLedger(workspace.workspaceRoot);
    ledger.mark('src/app.ts');
    assert.ok(ledger.refs.some((f) => f.relativePath === 'src/app.ts' && f.rootId === workspace.workspaceRoot));
  });

  it('replaces changed files when session state is loaded', () => {
    const ledger = new ChangeLedger(workspace.workspaceRoot);
    ledger.mark('old.ts');
    ledger.replace(['new.ts']);
    assert.deepStrictEqual(ledger.refs, [
      { rootId: workspace.workspaceRoot, relativePath: 'new.ts' },
    ]);
  });
});

describe('WorkspaceManager additional roots (VC-KIMI-044)', () => {
  it('resolves absolute paths inside an additional root', () => {
    const primary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-primary-'))) ;
    const extra = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-extra-')));
    fs.writeFileSync(path.join(extra, 'extra.txt'), 'extra');
    const workspace = new WorkspaceManager(primary, [extra]);

    const resolved = workspace.resolve(path.join(extra, 'extra.txt'));
    assert.strictEqual(resolved.root, extra);
    assert.strictEqual(resolved.relative, 'extra.txt');
    assert.ok(workspace.isInsideWorkspace(path.join(extra, 'extra.txt')));
  });

  it('rejects absolute paths outside all roots', () => {
    const primary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-primary-')));
    const extra = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-extra-')));
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-outside-')));
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
    const workspace = new WorkspaceManager(primary, [extra]);
    assert.throws(() => workspace.resolve(path.join(outside, 'secret.txt')), /outside workspace/);
  });

  it('tracks changed files in additional roots by absolute path', () => {
    const primary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-primary-')));
    const extra = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-extra-')));
    fs.writeFileSync(path.join(extra, 'extra.txt'), 'extra');
    const workspace = new WorkspaceManager(primary, [extra]);
    const ledger = new ChangeLedger(primary);

    const resolved = workspace.resolve(path.join(extra, 'extra.txt'));
    ledger.mark({ rootId: resolved.root, relativePath: resolved.relative });
    assert.ok(ledger.refs.some((f) => f.rootId === extra && f.relativePath === 'extra.txt'));

    const primaryResolved = workspace.resolve('src/app.ts');
    ledger.mark({ rootId: primaryResolved.root, relativePath: primaryResolved.relative });
    assert.ok(
      ledger.refs.some((f) => f.rootId === primary && f.relativePath === 'src/app.ts')
    );
  });
});

describe('detectGitRoot', () => {
  it('finds git root', () => {
    const root = detectGitRoot(process.cwd());
    assert.ok(root);
    assert.ok(fs.existsSync(path.join(root, '.git')));
  });

  it('returns a canonical cwd when the directory is not in a Git repository', () => {
    const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-no-git-')));
    const nested = path.join(parent, 'nested');
    fs.mkdirSync(nested);
    assert.strictEqual(detectGitRoot(nested), fs.realpathSync(nested));
  });

  it('canonicalizes a symlinked cwd before choosing the workspace identity', () => {
    if (process.platform === 'win32') return;
    const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-cwd-link-')));
    const target = path.join(parent, 'target');
    const link = path.join(parent, 'link');
    fs.mkdirSync(target);
    fs.symlinkSync(target, link, 'dir');
    assert.strictEqual(detectGitRoot(link), fs.realpathSync(target));
  });
});
