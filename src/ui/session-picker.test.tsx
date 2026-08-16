import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { render } from 'ink-testing-library';
import { SessionPicker } from './session-picker.js';
import { SessionManager } from '../agent/sessions.js';

describe('SessionPicker', () => {
  let tmp: string;
  let manager: SessionManager;

  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-session-picker-test-')));
    manager = new SessionManager(path.join(tmp, 'sessions'));
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('lists saved sessions', () => {
    manager.save(
      {
        sessionId: 'session-abc',
        workspaceRoot: '/tmp',
        workspace: { primaryRoot: '/tmp', additionalRoots: [] },
        model: 'kimi-k2.5',
        objective: 'Test session',
        status: 'complete',
        mode: { inputMode: 'agent', operatingMode: 'agent', permissionMode: 'suggest' },
        messages: [],
        todos: [],
        relevantFiles: [],
        changedFiles: [],
        toolHistory: [],
        skillSummaries: [],
        activeSkills: [],
      },
      []
    );

    const { lastFrame } = render(<SessionPicker onSelect={() => {}} manager={manager} />);
    const frame = lastFrame() || '';
    assert.ok(frame.includes('Test session'));
    assert.ok(frame.includes('session-abc') || frame.includes('Select session'));
  });

  it('shows empty state when no sessions exist', () => {
    fs.rmSync(tmp, { recursive: true, force: true });
    const { lastFrame } = render(<SessionPicker onSelect={() => {}} manager={manager} />);
    const frame = lastFrame() || '';
    assert.ok(frame.includes('No saved sessions'));
  });

  it('hides sessions from other workspaces', () => {
    manager.save(
      {
        sessionId: 'other-workspace',
        workspaceRoot: '/tmp',
        workspace: { primaryRoot: '/tmp', additionalRoots: [] },
        model: 'kimi-k2.5',
        objective: 'Hidden session',
        status: 'complete',
        mode: { inputMode: 'agent', operatingMode: 'agent', permissionMode: 'suggest' },
        messages: [],
        todos: [],
        relevantFiles: [],
        changedFiles: [],
        toolHistory: [],
        skillSummaries: [],
        activeSkills: [],
      },
      []
    );

    const { lastFrame } = render(
      <SessionPicker onSelect={() => {}} manager={manager} workspaceRoot="/different-workspace" />
    );
    assert.ok((lastFrame() || '').includes('No saved sessions'));
  });
});
