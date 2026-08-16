import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionManager } from './sessions.js';
import type { AgentState } from './types.js';
import type { AgentEvent } from './events.js';

describe('Security and Secret Redaction', () => {
  let tmp: string;
  let manager: SessionManager;

  before(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'venice-security-test-')));
    // Initialize SessionManager with known secrets to test the Redactor integration
    process.env.VENICE_API_KEY = 'vnc_dummy_api_key_for_testing';
    manager = new SessionManager(tmp);
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    delete process.env.VENICE_API_KEY;
  });

  const state = (id: string, messages: any[]): AgentState => ({
    sessionId: id,
    workspaceRoot: '/tmp',
    model: 'test',
    objective: 'test',
    status: 'idle',
    messages,
    todos: [],
    relevantFiles: [],
    changedFiles: [],
    toolHistory: [],
    skillSummaries: [],
    activeSkills: [],
  });

  it('redacts tokens from messages when saving to session.json', () => {
    const id = 's-redact-1';
    const testState = state(id, [
      { role: 'user', content: 'Here is my token: vnc_dummy_api_key_for_testing' },
      { role: 'assistant', content: 'I should not echo Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy.signature back' }
    ]);

    manager.save(testState, []);
    
    // Load directly from file system to verify what was actually written
    const sessionPath = path.join(tmp, id, 'session.json');
    const diskContent = fs.readFileSync(sessionPath, 'utf-8');
    
    assert.strictEqual(diskContent.includes('vnc_dummy_api_key_for_testing'), false, 'Known secret leaked into session.json');
    assert.strictEqual(diskContent.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.dummy.signature'), false, 'JWT leaked into session.json');
    assert.strictEqual(diskContent.includes('***REDACTED***'), true, 'Redaction marker missing from session.json');

    // Also check the jsonl projections
    const messagesPath = path.join(tmp, id, 'messages.jsonl');
    const messagesContent = fs.readFileSync(messagesPath, 'utf-8');
    assert.strictEqual(messagesContent.includes('vnc_dummy_api_key_for_testing'), false, 'Known secret leaked into messages.jsonl');
  });

  it('redacts tokens from tool events', () => {
    const id = 's-redact-2';
    const events: AgentEvent[] = [
      {
        type: 'tool_completed',
        timestamp: new Date().toISOString(),
        eventId: 'e1',
        toolName: 'run_command',
        input: 'curl -H "Authorization: Bearer super-secret-token-1234567890" https://api.venice.ai/v1/models',
        result: 'Success'
      }
    ];

    manager.save(state(id, []), events);
    
    // Load directly from file system
    const sessionPath = path.join(tmp, id, 'session.json');
    const diskContent = fs.readFileSync(sessionPath, 'utf-8');
    
    assert.strictEqual(diskContent.includes('super-secret-token-1234567890'), false, 'Tool input token leaked into session.json');
    assert.strictEqual(diskContent.includes('***REDACTED***'), true, 'Redaction marker missing from tool input in session.json');

    const eventsPath = path.join(tmp, id, 'events.jsonl');
    const eventsContent = fs.readFileSync(eventsPath, 'utf-8');
    assert.strictEqual(eventsContent.includes('super-secret-token-1234567890'), false, 'Tool input token leaked into events.jsonl');
  });
});
