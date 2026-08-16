/**
 * Import a previously exported session (round-trips with `venice export --format json`).
 */

import { Command } from 'commander';
import { SessionImportService } from '../agent/session-import.js';
import { formatError } from '../lib/output.js';

export function registerImportCommand(program: Command): void {
  program
    .command('import <file>')
    .description('Import a previously exported session (JSON)')
    .option('--force', 'Overwrite an existing session with the same id')
    .option('--fork', 'Import under a new session id instead of the stored one')
    .action((file: string, options) => {
      try {
        const result = new SessionImportService().importFile(file, {
          force: Boolean(options.force),
          fork: Boolean(options.fork),
        });
        console.log(
          `Imported session ${result.sessionId}${result.importedAs === 'forked' ? ' (forked)' : ''}`
        );
      } catch (error) {
        console.error(formatError(error instanceof Error ? error.message : String(error)));
        process.exit(2);
      }
    });
}
