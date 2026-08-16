import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { skillListTool } from './skill-list.js';
import { skillLoadTool } from './skill-load.js';
import { SkillRegistry } from '../../skills/registry.js';
import type { AgentState } from '../../agent/types.js';

const state: AgentState = {
  sessionId: 's',
  workspaceRoot: '/tmp',
  workspace: { primaryRoot: '/tmp', additionalRoots: [] },
  model: 'm',
  objective: 'o',
  status: 'idle',
  mode: { inputMode: 'agent', operatingMode: 'agent', permissionMode: 'suggest' },
  messages: [],
  todos: [],
  relevantFiles: [],
  changedFiles: [],
  toolHistory: [],
  skillSummaries: [{ name: 'x', description: 'd', tools: [], source: 's' }],
  activeSkills: [],
};

describe('skill meta tools', () => {
  it('skill_list returns summaries from runtime state', async () => {
    const result = await skillListTool.execute({}, {
      workspaceRoot: '/tmp',
      sessionId: 's',
      objective: 'o',
      runtimeState: state,
    });
    assert.strictEqual(result.ok, true);
    assert.ok(Array.isArray(result.data));
    assert.strictEqual((result.data as unknown[]).length, 1);
  });

  it('skill_load returns full skill content', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-load-'));
    const skillDir = path.join(dir, 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---\nname: my-skill\ndescription: My skill.\ntools:\n  - shell\n---\n\nDo the thing.\n`
    );

    const registry = new SkillRegistry(dir);
    registry.discover();
    const result = await skillLoadTool.execute({ name: 'my-skill' }, {
      workspaceRoot: '/tmp',
      sessionId: 's',
      objective: 'o',
      runtimeState: state,
      skillRegistry: registry,
    });

    assert.strictEqual(result.ok, true);
    const data = result.data as { name: string; content: string; tools: string[] };
    assert.strictEqual(data.name, 'my-skill');
    assert.ok(data.content.includes('Do the thing.'));
    assert.deepStrictEqual(data.tools, ['shell']);
  });

  it('skill_load returns an error for missing skills', async () => {
    const registry = new SkillRegistry('/tmp/empty-skills-dir');
    registry.discover();
    const result = await skillLoadTool.execute({ name: 'missing' }, {
      workspaceRoot: '/tmp',
      sessionId: 's',
      objective: 'o',
      runtimeState: state,
      skillRegistry: registry,
    });
    assert.strictEqual(result.ok, false);
    assert.ok(String(result.error?.message).includes('missing'));
  });
});
