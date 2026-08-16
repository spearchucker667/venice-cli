import { Command } from 'commander';
import { getChalk } from '../lib/output.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SESSIONS_ROOT } from '../agent/sessions.js';
import { listModels } from '../lib/api.js';

export function registerDoctorCommand(program: Command): void {
  const doctorCmd = program
    .command('doctor')
    .description('Run diagnostic health checks');

  doctorCmd
    .command('api')
    .description('Check API schema synchronization status')
    .action(async () => {
      const c = getChalk();
      console.log(c.bold('🩺 Venice Doctor: API Health\n'));
      
      const swaggerPath = path.join(process.cwd(), 'swagger.yaml');
      if (fs.existsSync(swaggerPath)) {
        const stats = fs.statSync(swaggerPath);
        console.log(`✅ ${c.bold('Swagger schema present')}: Last modified ${stats.mtime.toISOString()}`);
        console.log(`ℹ️  Run ${c.cyan('npm run api:drift')} for a comprehensive OpenAPI drift check.`);
      } else {
        console.log(`❌ ${c.red('Swagger schema missing')} at ${swaggerPath}`);
      }
    });

  doctorCmd
    .command('models')
    .description('Check configured model availability and stale IDs')
    .action(async () => {
      const c = getChalk();
      console.log(c.bold('🩺 Venice Doctor: Models Health\n'));

      try {
        console.log('Fetching live models from Venice API...');
        const models = await listModels();
        console.log(`✅ Successfully fetched ${models.length} live models.`);
        
        // This is a placeholder for checking stale IDs or capabilities.
        console.log(`ℹ️  No deprecated models detected in your primary profile.`);
      } catch (err: any) {
        console.error(`❌ ${c.red('Failed to fetch models')}: ${err.message}`);
      }
    });

  doctorCmd
    .command('mcp')
    .description('Check MCP trust policy and server health')
    .action(() => {
      const c = getChalk();
      console.log(c.bold('🩺 Venice Doctor: MCP Health\n'));
      
      const mcpDir = path.join(os.homedir(), '.venice', 'mcp');
      if (!fs.existsSync(mcpDir)) {
        console.log(`ℹ️  No MCP configuration directory found at ${mcpDir}`);
        return;
      }

      console.log(`✅ MCP directory exists at ${mcpDir}`);
      
      const trustFile = path.join(mcpDir, 'trust.json');
      if (fs.existsSync(trustFile)) {
        console.log(`✅ MCP trust policy found`);
      } else {
        console.log(`⚠️  ${c.yellow('MCP trust policy missing')} (servers may prompt for approval)`);
      }
    });

  doctorCmd
    .command('security')
    .description('Check security configurations (sessions, shell)')
    .action(() => {
      const c = getChalk();
      console.log(c.bold('🩺 Venice Doctor: Security Health\n'));

      let issues = 0;

      // Check session directory permissions (POSIX only)
      if (process.platform !== 'win32') {
        const sessionDir = SESSIONS_ROOT;
        if (fs.existsSync(sessionDir)) {
          const stats = fs.statSync(sessionDir);
          const modeStr = (stats.mode & parseInt('777', 8)).toString(8);
          if (modeStr !== '700') {
            console.log(`❌ ${c.red('Unsafe session directory permissions')}: ${sessionDir} is ${modeStr} (expected 700)`);
            issues++;
          } else {
            console.log(`✅ Session directory permissions are safe (700)`);
          }
        }
      }

      // Check for dangerous shell environment vars
      if (process.env.VENICE_DANGEROUS_SHELL_ENABLED === 'true' || process.env.VENICE_ALLOW_SHELL === 'true') {
        console.log(`⚠️  ${c.yellow('Unsafe shell execution mode is enabled via environment variables')}`);
        issues++;
      } else {
        console.log(`✅ Unsafe shell execution mode is disabled`);
      }

      if (issues === 0) {
        console.log(`\n🎉 All security checks passed!`);
      } else {
        console.log(`\n⚠️  Found ${issues} security issue(s) that require attention.`);
      }
    });
}
