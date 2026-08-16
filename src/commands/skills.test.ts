import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Command } from 'commander';
import { registerSkillsCommand } from './skills.js';

describe('registerSkillsCommand', () => {
  it('lists discovered skills', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-cmd-'));
    const skillDir = path.join(dir, 'test');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---\nname: test\ndescription: Test skill.\ntools:\n  - shell\n---\n\nBody.\n`
    );

    const program = new Command();
    registerSkillsCommand(program, dir);

    const originalLog = console.log;
    let output = '';
    console.log = (s: string) => { output += String(s) + '\n'; };
    try {
      await program.parseAsync(['node', 'venice', 'skills', 'list']);
    } finally {
      console.log = originalLog;
    }

    assert.ok(output.includes('test'));
    assert.ok(output.includes('Test skill'));
    assert.ok(output.includes('shell'));
  });

  it('shows skill content', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-cmd-'));
    const skillDir = path.join(dir, 'my-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---\nname: my-skill\ndescription: My skill.\n---\n\nSkill body.\n`
    );

    const program = new Command();
    registerSkillsCommand(program, dir);

    const originalLog = console.log;
    let output = '';
    console.log = (s: string) => { output += String(s) + '\n'; };
    try {
      await program.parseAsync(['node', 'venice', 'skills', 'show', 'my-skill']);
    } finally {
      console.log = originalLog;
    }

    assert.ok(output.includes('Skill body'));
  });
});
