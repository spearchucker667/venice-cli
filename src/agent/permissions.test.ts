import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PermissionManager } from './permissions.js';

describe('PermissionManager', () => {
  it('changes the live approval policy and clears prior grants', async () => {
    const permissions = new PermissionManager('suggest');
    permissions.grant('session', 'write_file');
    permissions.setMode('auto-edit');
    assert.strictEqual(permissions.getMode(), 'auto-edit');
    assert.strictEqual(await permissions.isApproved('write_file', {}, 'write'), true);
    permissions.setMode('suggest');
    assert.strictEqual(await permissions.isApproved('write_file', {}, 'write'), false);
  });
  it('suggest mode requires approval for writes', async () => {
    const pm = new PermissionManager('suggest');
    assert.strictEqual(await pm.isApproved('write_file', { path: 'x' }, 'write'), false);
  });

  it('auto-edit mode auto-approves workspace writes', async () => {
    const pm = new PermissionManager('auto-edit');
    assert.strictEqual(await pm.isApproved('write_file', { path: 'x' }, 'write'), true);
  });

  it('auto-edit mode auto-approves run_validation', async () => {
    const pm = new PermissionManager('auto-edit');
    assert.strictEqual(await pm.isApproved('run_validation', { command: 'npm test' }, 'execute'), true);
  });

  it('suggest mode requires approval for run_validation', async () => {
    const pm = new PermissionManager('suggest');
    assert.strictEqual(await pm.isApproved('run_validation', { command: 'npm test' }, 'execute'), false);
  });

  it('does not auto-approve shell external side effects in auto mode', async () => {
    const pm = new PermissionManager('auto');
    assert.strictEqual(await pm.isApproved('shell', { command: 'curl https://example.com' }, 'external_side_effect'), false);
  });

  it('does not auto-approve mcp tools in auto mode', async () => {
    const pm = new PermissionManager('auto');
    assert.strictEqual(await pm.isApproved('mcp:github:create_issue', { title: 'x' }, 'external_side_effect'), false);
  });

  it('auto mode auto-approves ordinary shell commands classified as execute (VC-KIMI-057)', async () => {
    const pm = new PermissionManager('auto');
    assert.strictEqual(await pm.isApproved('shell', { command: 'npm test' }, 'execute'), true);
    assert.strictEqual(await pm.isApproved('shell', { command: 'git status' }, 'execute'), true);
  });

  it('auto mode still auto-approves ordinary execute tools', async () => {
    const pm = new PermissionManager('auto');
    assert.strictEqual(await pm.isApproved('spawn_agent', { task: 'review' }, 'execute'), true);
  });

  it('yolo mode still requires approval for destructive ops', async () => {
    const pm = new PermissionManager('yolo');
    assert.strictEqual(await pm.isApproved('shell', { command: 'rm -rf /' }, 'destructive'), false);
  });

  it('session grant persists', async () => {
    const pm = new PermissionManager('suggest');
    pm.grant('session', 'write_file');
    assert.strictEqual(await pm.isApproved('write_file', { path: 'x' }, 'write'), true);
  });
});

describe('risk-scoped grants (VC-KIMI-009)', () => {
  it('a session grant does not cover a more severe risk', async () => {
    const pm = new PermissionManager('suggest');
    pm.grant('session', 'shell', undefined, 'execute');
    assert.strictEqual(await pm.isApproved('shell', { command: 'npm test' }, 'execute'), true);
    assert.strictEqual(await pm.isApproved('shell', { command: 'curl https://evil.example' }, 'external_side_effect'), false);
  });

  it('a session grant never covers destructive operations', async () => {
    const pm = new PermissionManager('suggest');
    pm.grant('session', 'shell', undefined, 'execute');
    assert.strictEqual(await pm.isApproved('shell', { command: 'rm -rf /' }, 'destructive'), false);
    pm.grant('session', 'shell', undefined, 'destructive');
    assert.strictEqual(await pm.isApproved('shell', { command: 'rm -rf /tmp/x' }, 'destructive'), false);
  });

  it('a grant issued at a higher risk covers equal or lower risks', async () => {
    const pm = new PermissionManager('suggest');
    pm.grant('session', 'shell', undefined, 'external_side_effect');
    assert.strictEqual(await pm.isApproved('shell', { command: 'curl x' }, 'external_side_effect'), true);
    assert.strictEqual(await pm.isApproved('shell', { command: 'npm test' }, 'execute'), true);
    assert.strictEqual(await pm.isApproved('shell', { command: 'rm -rf /' }, 'destructive'), false);
  });

  it('a deliberately destructive pattern matcher can cover destructive calls', async () => {
    const pm = new PermissionManager('suggest');
    pm.grant(
      'pattern',
      'shell',
      { kind: 'command-prefix', field: 'command', value: 'rm -rf /tmp/scratch' },
      'destructive'
    );
    assert.strictEqual(await pm.isApproved('shell', { command: 'rm -rf /tmp/scratch' }, 'destructive'), true);
    assert.strictEqual(await pm.isApproved('shell', { command: 'rm -rf /home' }, 'destructive'), false);
  });

  it('legacy grants without a risk default to a write ceiling', async () => {
    const pm = new PermissionManager('suggest');
    pm.grant('session', 'write_file');
    assert.strictEqual(await pm.isApproved('write_file', {}, 'write'), true);
    assert.strictEqual(await pm.isApproved('write_file', {}, 'execute'), false);
  });
});

describe('matchers (VC-KIMI-070/071)', () => {
  it('command-prefix matches at a shell token boundary', async () => {
    const pm = new PermissionManager('suggest');
    pm.grant('pattern', 'shell', { kind: 'command-prefix', field: 'command', value: 'git' }, 'execute');
    assert.strictEqual(await pm.isApproved('shell', { command: 'git status' }, 'execute'), true);
    assert.strictEqual(await pm.isApproved('shell', { command: 'git' }, 'execute'), true);
    assert.strictEqual(await pm.isApproved('shell', { command: 'gitty' }, 'execute'), false);
    assert.strictEqual(await pm.isApproved('shell', { command: 'git push' }, 'execute'), true);
  });

  it('path-glob treats regex metacharacters literally', async () => {
    const pm = new PermissionManager('suggest');
    pm.grant('pattern', 'read_file', { kind: 'path-glob', field: 'path', value: 'src/**/*.test.ts' }, 'read');
    assert.strictEqual(await pm.isApproved('read_file', { path: 'src/mcp/env.test.ts' }, 'read'), true);
    assert.strictEqual(await pm.isApproved('read_file', { path: 'src/mcp/env.test.js' }, 'read'), false);
    assert.strictEqual(await pm.isApproved('read_file', { path: 'src/mcp/a.b.test.ts' }, 'read'), true);

    pm.grant('pattern', 'read_file', { kind: 'path-glob', field: 'path', value: 'a+b/(file).txt' }, 'read');
    assert.strictEqual(await pm.isApproved('read_file', { path: 'a+b/(file).txt' }, 'read'), true);
    assert.strictEqual(await pm.isApproved('read_file', { path: 'aXb/(file).txt' }, 'read'), false);
  });

  it('path-glob accepts windows-style backslash separators', async () => {
    const pm = new PermissionManager('suggest');
    pm.grant('pattern', 'read_file', { kind: 'path-glob', field: 'path', value: 'src/**/x.ts' }, 'read');
    assert.strictEqual(await pm.isApproved('read_file', { path: 'src\\mcp\\x.ts' }, 'read'), true);
  });
});
