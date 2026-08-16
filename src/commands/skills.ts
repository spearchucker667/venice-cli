/**
 * `venice skills` command — discover and inspect agent skills.
 */

import { Command } from 'commander';
import { SkillRegistry, getGlobalSkillsDir } from '../skills/registry.js';
import { formatError, getChalk } from '../lib/output.js';

export function registerSkillsCommand(program: Command, globalDir = getGlobalSkillsDir()): void {
  const skills = program.command('skills').description('Manage Venice agent skills');
  const c = getChalk();

  skills
    .command('list')
    .description('List discovered skills')
    .option('--json', 'Output as JSON')
    .action((options) => {
      const registry = new SkillRegistry(globalDir);
      registry.discover();
      const list = registry.list();
      if (options.json) {
        console.log(JSON.stringify({ skills: list }, null, 2));
      } else {
        if (list.length === 0) {
          console.log('No skills discovered.');
          return;
        }
        for (const skill of list) {
          console.log(`${c.bold(skill.name)}: ${skill.description}`);
          if (skill.tools.length) {
            console.log(`  tools: ${skill.tools.join(', ')}`);
          }
        }
      }
    });

  skills
    .command('show <name>')
    .description('Show the full content of a skill')
    .action((name: string) => {
      const registry = new SkillRegistry(globalDir);
      registry.discover();
      const skill = registry.load(name);
      if (!skill) {
        console.error(formatError(`Skill not found: ${name}`));
        process.exit(1);
      }
      console.log(skill.content);
    });
}
