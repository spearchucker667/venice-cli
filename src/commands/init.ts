/**
 * Init command — scaffold workspace .venice/ configuration.
 */

import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectWorkspaceRoot } from '../agent/runtime.js';
import { formatError, getChalk } from '../lib/output.js';

export interface InitResult {
  workspaceRoot: string;
  createdFiles: string[];
  skippedFiles: string[];
}

export function scaffoldVeniceWorkspace(workspaceRoot: string, options: { force?: boolean } = {}): InitResult {
  const veniceDir = join(workspaceRoot, '.venice');
  const skillsDir = join(veniceDir, 'skills');

  if (!existsSync(veniceDir)) {
    mkdirSync(veniceDir, { recursive: true });
  }
  if (!existsSync(skillsDir)) {
    mkdirSync(skillsDir, { recursive: true });
  }

  const createdFiles: string[] = [];
  const skippedFiles: string[] = [];

  const filesToScaffold: Array<{ path: string; content: string }> = [
    {
      path: join(veniceDir, 'config.json'),
      content: JSON.stringify(
        {
          agent: {
            approvalMode: 'suggest',
            autoValidate: true,
          },
          context: {
            autoCompact: true,
          },
        },
        null,
        2
      ) + '\n',
    },
    {
      path: join(veniceDir, 'instructions.md'),
      content: `# Project Instructions for Venice Agent\n\n## Guidelines\n- Verify tests and linting after making changes.\n- Preserve existing coding conventions and file structures.\n`,
    },
    {
      path: join(veniceDir, 'mcp.json'),
      content: JSON.stringify(
        {
          mcpServers: {},
        },
        null,
        2
      ) + '\n',
    },
  ];

  for (const file of filesToScaffold) {
    if (existsSync(file.path) && !options.force) {
      skippedFiles.push(file.path);
    } else {
      writeFileSync(file.path, file.content, 'utf-8');
      createdFiles.push(file.path);
    }
  }

  return { workspaceRoot, createdFiles, skippedFiles };
}

export function registerInitCommand(program: Command): Command {
  return program
    .command('init')
    .description('Scaffold .venice configuration, instructions, and MCP settings in the current workspace')
    .option('--cwd <path>', 'Workspace directory to initialize')
    .option('-f, --force', 'Overwrite existing .venice configuration files')
    .action((options) => {
      const c = getChalk();
      try {
        const cwd = options.cwd ? String(options.cwd) : process.cwd();
        const workspaceRoot = detectWorkspaceRoot(cwd);
        const result = scaffoldVeniceWorkspace(workspaceRoot, { force: options.force });

        console.log(c.bold(`\nInitialized Venice workspace at: ${result.workspaceRoot}\n`));
        if (result.createdFiles.length > 0) {
          console.log(c.green('Created:'));
          for (const file of result.createdFiles) {
            console.log(`  + ${file}`);
          }
        }
        if (result.skippedFiles.length > 0) {
          console.log(c.yellow('Skipped existing:'));
          for (const file of result.skippedFiles) {
            console.log(`  - ${file}`);
          }
        }
      } catch (error) {
        console.error(formatError(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });
}
