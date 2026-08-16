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

  it('does not auto-approve shell in auto mode', async () => {
    const pm = new PermissionManager('auto');
    assert.strictEqual(await pm.isApproved('shell', { command: 'echo hi' }, 'external_side_effect'), false);
  });

  it('does not auto-approve mcp tools in auto mode', async () => {
    const pm = new PermissionManager('auto');
    assert.strictEqual(await pm.isApproved('mcp:github:create_issue', { title: 'x' }, 'external_side_effect'), false);
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
