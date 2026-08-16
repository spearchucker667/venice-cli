import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PermissionManager, classifyRisk } from './permissions.js';

describe('PermissionManager', () => {
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

describe('classifyRisk', () => {
  it('classifies shell as execute', () => {
    assert.strictEqual(classifyRisk('shell', { command: 'echo hi' }), 'execute');
  });

  it('classifies destructive shell commands', () => {
    assert.strictEqual(classifyRisk('shell', { command: 'rm -rf /' }), 'destructive');
  });

  it('classifies read tools', () => {
    assert.strictEqual(classifyRisk('read_file', { path: 'x' }), 'read');
  });

  it('classifies spawn_agent as execute', () => {
    assert.strictEqual(classifyRisk('spawn_agent', { task: 'inspect' }), 'execute');
  });

  it('classifies Venice media tools as network', () => {
    assert.strictEqual(classifyRisk('edit_image', { image: 'a.png', prompt: 'x', output: 'b.png' }), 'network');
    assert.strictEqual(classifyRisk('generate_video', { prompt: 'a clip' }), 'network');
    assert.strictEqual(classifyRisk('text_to_speech', { text: 'hi', output: 'out.mp3' }), 'network');
  });
});
