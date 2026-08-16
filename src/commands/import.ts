/**
 * Import a previously exported session.
 */

import { Command } from 'commander';
import * as fs from 'node:fs';
import { SessionManager } from '../agent/sessions.js';
import { formatError } from '../lib/output.js';
import type { StoredSession } from '../agent/sessions.js';

export function registerImportCommand(program: Command): void {
  program
    .command('import <file>')
    .description('Import a previously exported session')
    .action(async (file: string) => {
      if (!fs.existsSync(file)) {
        console.error(formatError(`File not found: ${file}`));
        process.exit(2);
      }

      let stored: StoredSession;
      try {
        stored = JSON.parse(fs.readFileSync(file, 'utf-8')) as StoredSession;
      } catch (error) {
        console.error(formatError(`Failed to parse session file: ${error instanceof Error ? error.message : String(error)}`));
        process.exit(2);
      }

      if (!stored.state || typeof stored.state !== 'object' || !stored.state.sessionId) {
        console.error(formatError('Invalid session export file'));
        process.exit(2);
      }

      const manager = new SessionManager();
      manager.save(stored.state, stored.events || []);
      console.log(`Imported session ${stored.state.sessionId}`);
    });
}
