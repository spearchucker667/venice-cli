import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { parseSkillMarkdown, parseFrontmatter } from './parser.js';

describe('parseFrontmatter', () => {
  it('parses YAML-style frontmatter', () => {
    const content = `---
name: github-release
description: Prepare releases.
tools:
  - shell
  - read_file
---

# Body
`;
    const { metadata, body } = parseFrontmatter(content);
    assert.strictEqual(metadata.name, 'github-release');
    assert.strictEqual(metadata.description, 'Prepare releases.');
    assert.deepStrictEqual(metadata.tools, ['shell', 'read_file']);
    assert.ok(body.includes('# Body'));
  });

  it('returns empty metadata for files without frontmatter', () => {
    const { metadata, body } = parseFrontmatter('# Just body');
    assert.deepStrictEqual(metadata, {});
    assert.strictEqual(body, '# Just body');
  });
});

describe('parseSkillMarkdown', () => {
  it('parses a SKILL.md file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-parser-'));
    const file = path.join(dir, 'SKILL.md');
    fs.writeFileSync(file, `---\nname: test-skill\ndescription: A test skill.\n---\n\nDo things.\n`);
    const skill = parseSkillMarkdown(file);
    assert.ok(skill);
    assert.strictEqual(skill?.name, 'test-skill');
    assert.strictEqual(skill?.description, 'A test skill.');
    assert.deepStrictEqual(skill?.tools, []);
    assert.strictEqual(skill?.source, file);
  });

  it('returns undefined for missing files', () => {
    const skill = parseSkillMarkdown(path.join(os.tmpdir(), 'does-not-exist.md'));
    assert.strictEqual(skill, undefined);
  });
});
