import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { WorkspaceManager, detectGitRoot } from './workspace.js';

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

  it('tracks changed files', () => {
    workspace.markChanged('src/app.ts');
    assert.ok(workspace.changedFiles.includes('src/app.ts'));
  });
});

describe('detectGitRoot', () => {
  it('finds git root', () => {
    const root = detectGitRoot(process.cwd());
    assert.ok(root);
    assert.ok(fs.existsSync(path.join(root!, '.git')));
  });
});
