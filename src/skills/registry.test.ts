import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SkillRegistry, getGlobalSkillsDir, getProjectSkillsDir } from './registry.js';

describe('SkillRegistry', () => {
  let globalDir: string;
  let projectDir: string;

  before(() => {
    globalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-global-'));
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-project-'));

    const skillDir = path.join(globalDir, 'release');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---\nname: release\ndescription: Release skill.\ntools:\n  - shell\n---\n\nRelease steps.\n`
    );
  });

  it('discovers skills from global and project directories', () => {
    const registry = new SkillRegistry(globalDir, projectDir);
    registry.discover();
    const list = registry.list();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].name, 'release');
  });

  it('loads a skill by name', () => {
    const registry = new SkillRegistry(globalDir, projectDir);
    registry.discover();
    const skill = registry.load('release');
    assert.ok(skill);
    assert.ok(skill?.content.includes('Release steps'));
  });

  it('discovers project skills that override global skills with the same name', () => {
    const localSkillDir = path.join(projectDir, 'release');
    fs.mkdirSync(localSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(localSkillDir, 'SKILL.md'),
      `---\nname: release\ndescription: Project release skill.\n---\n\nProject-specific release steps.\n`
    );
    const registry = new SkillRegistry(globalDir, projectDir);
    registry.discover();
    const skill = registry.load('release');
    assert.ok(skill);
    assert.strictEqual(skill?.description, 'Project release skill.');
    assert.ok(skill?.content.includes('Project-specific release steps'));
  });
});

describe('getGlobalSkillsDir', () => {
  it('returns ~/.config/venice/skills', () => {
    const dir = getGlobalSkillsDir();
    assert.ok(dir.includes('.config'));
    assert.ok(dir.endsWith(path.join('venice', 'skills')));
  });
});

describe('getProjectSkillsDir', () => {
  it('returns .venice/skills under the workspace root', () => {
    const dir = getProjectSkillsDir('/tmp/workspace');
    assert.strictEqual(dir, path.join('/tmp/workspace', '.venice', 'skills'));
  });
});
