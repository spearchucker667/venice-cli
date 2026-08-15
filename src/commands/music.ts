/**
 * Music Commands - asynchronous music and sound-effects generation
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import {
  completeAudioGeneration,
  listModels,
  queueAudioGeneration,
  quoteAudioGeneration,
  retrieveGeneratedAudio,
  type AudioProcessingStatus,
} from '../lib/api.js';
import { MAX_AUDIO_DOWNLOAD_BYTES, writeResponseToFile } from '../lib/media.js';
import { detectOutputFormat, formatError, formatSuccess, getChalk } from '../lib/output.js';
import type { Model } from '../types/index.js';

const DEFAULT_MUSIC_MODEL = 'elevenlabs-music';
const POLL_INTERVAL_MS = 5000;

function positiveInteger(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function extensionForContentType(contentType: string): string {
  const extensions: Record<string, string> = {
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/flac': '.flac',
  };
  return extensions[contentType] || '.bin';
}

function printProcessingStatus(status: AudioProcessingStatus): void {
  const c = getChalk();
  const normalized = status.status.toLowerCase();
  const color = normalized === 'failed'
    ? c.red
    : normalized === 'processing' || normalized === 'queued'
      ? c.blue
      : c.green;

  console.log(`${c.dim('Status:')} ${color(status.status)}`);
  if (status.average_execution_time !== undefined) {
    const remainingMs = Math.max(
      0,
      status.average_execution_time - (status.execution_duration || 0)
    );
    console.log(`${c.dim('Estimated remaining:')} ~${Math.ceil(remainingMs / 1000)}s`);
  }
  if (status.error) {
    console.error(`${c.red('Error:')} ${status.error}`);
  }
}

export function registerMusicCommands(program: Command): void {
  const music = program
    .command('music')
    .description('Generate music and sound effects');

  music
    .command('generate <prompt...>')
    .alias('gen')
    .description('Queue a music or sound-effects generation job')
    .option('-m, --model <model>', 'Model to use', DEFAULT_MUSIC_MODEL)
    .option('-l, --lyrics <path>', 'Read song lyrics from a file')
    .option('-d, --duration <seconds>', 'Output duration in seconds')
    .option('-i, --instrumental', 'Force instrumental output (supported models only)')
    .option('-f, --format <format>', 'Output format (pretty|json)')
    .action(async (promptParts: string[], options) => {
      const format = detectOutputFormat(options.format);
      const c = getChalk();

      try {
        let lyricsPrompt: string | undefined;
        if (options.lyrics) {
          const lyricsPath = path.resolve(options.lyrics);
          if (!fs.existsSync(lyricsPath)) {
            throw new Error(`Lyrics file not found: ${options.lyrics}`);
          }
          lyricsPrompt = await fs.promises.readFile(lyricsPath, 'utf8');
        }

        const result = await queueAudioGeneration(promptParts.join(' '), {
          model: options.model,
          durationSeconds: positiveInteger(options.duration, 'Duration'),
          lyricsPrompt,
          forceInstrumental: options.instrumental || undefined,
        });

        if (format === 'json') {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(formatSuccess('Audio generation queued!'));
        console.log(`\n${c.dim('Queue ID:')} ${c.cyan(result.queue_id)}`);
        console.log(`${c.dim('Model:')} ${result.model}`);
        console.log(
          `\n${c.dim('Check status with:')} venice music status ${result.queue_id} -m ${result.model}`
        );
      } catch (error) {
        console.error(formatError(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  music
    .command('quote')
    .description('Estimate the cost of an audio generation')
    .option('-m, --model <model>', 'Model to use', DEFAULT_MUSIC_MODEL)
    .option('-d, --duration <seconds>', 'Output duration in seconds')
    .option('--character-count <count>', 'Character count for character-priced models')
    .option('-f, --format <format>', 'Output format (pretty|json)')
    .action(async (options) => {
      const format = detectOutputFormat(options.format);
      const c = getChalk();

      try {
        const result = await quoteAudioGeneration(options.model, {
          durationSeconds: positiveInteger(options.duration, 'Duration'),
          characterCount: positiveInteger(options.characterCount, 'Character count'),
        });

        if (format === 'json') {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`${c.dim('Estimated cost:')} ${c.green(`$${result.quote.toFixed(2)} USD`)}`);
          console.log(`${c.dim('Model:')} ${options.model}`);
        }
      } catch (error) {
        console.error(formatError(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  music
    .command('status <queueId>')
    .description('Check the status of an audio generation job')
    .option('-m, --model <model>', 'Model used for generation', DEFAULT_MUSIC_MODEL)
    .option('-w, --wait', 'Wait for completion (poll every 5s)')
    .option('-f, --format <format>', 'Output format (pretty|json)')
    .action(async (queueId: string, options) => {
      const format = detectOutputFormat(options.format);

      try {
        while (true) {
          const result = await retrieveGeneratedAudio(queueId, options.model);

          if (result.kind === 'audio') {
            await result.response.body?.cancel();
            const completed = {
              status: 'COMPLETED',
              content_type: result.contentType,
              size_bytes: result.sizeBytes,
            };
            if (format === 'json') {
              console.log(JSON.stringify(completed, null, 2));
            } else {
              printProcessingStatus(completed);
              console.log(
                `${getChalk().dim('Download with:')} venice music retrieve ${queueId} -m ${options.model}`
              );
            }
            return;
          }

          const isPending = ['processing', 'queued'].includes(result.status.status.toLowerCase());
          if (!options.wait || !isPending) {
            if (format === 'json') {
              console.log(JSON.stringify(result.status, null, 2));
            } else {
              printProcessingStatus(result.status);
            }
            return;
          }

          if (format !== 'json') {
            printProcessingStatus(result.status);
            console.log(getChalk().dim('Waiting...'));
          }
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        }
      } catch (error) {
        console.error(formatError(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  music
    .command('retrieve <queueId>')
    .alias('download')
    .description('Download completed generated audio')
    .option('-m, --model <model>', 'Model used for generation', DEFAULT_MUSIC_MODEL)
    .option('-o, --output <path>', 'Output file path')
    .option('--keep', 'Keep generated media on Venice after downloading')
    .option('-f, --format <format>', 'Output format (pretty|json)')
    .action(async (queueId: string, options) => {
      const format = detectOutputFormat(options.format);
      const c = getChalk();

      try {
        const result = await retrieveGeneratedAudio(queueId, options.model);
        if (result.kind === 'processing') {
          if (format === 'json') {
            console.log(JSON.stringify(result.status, null, 2));
          } else {
            printProcessingStatus(result.status);
            console.log(c.yellow('Audio is not ready yet.'));
          }
          return;
        }

        const outputPath = options.output ||
          `generated-audio${extensionForContentType(result.contentType)}`;
        const download = await writeResponseToFile(
          result.response,
          outputPath,
          {
            maxBytes: MAX_AUDIO_DOWNLOAD_BYTES,
            expectedContentTypePrefixes: ['audio/'],
          }
        );

        let cleanupSuccess: boolean | undefined;
        let cleanupError: string | undefined;
        if (!options.keep) {
          try {
            cleanupSuccess = (await completeAudioGeneration(queueId, options.model)).success;
          } catch (error) {
            cleanupSuccess = false;
            cleanupError = error instanceof Error ? error.message : String(error);
          }
        }

        if (format === 'json') {
          console.log(JSON.stringify({
            output: outputPath,
            content_type: result.contentType,
            size_bytes: download.bytesWritten,
            media_cleaned_up: cleanupSuccess,
            cleanup_error: cleanupError,
          }, null, 2));
          return;
        }

        console.log(formatSuccess(`Audio saved to ${outputPath}`));
        console.log(`${c.dim('Model:')} ${options.model}`);
        if (cleanupSuccess === false) {
          console.log(c.yellow(
            `Remote cleanup did not complete${cleanupError ? `: ${cleanupError}` : '.'}`
          ));
          console.log(c.dim(
            `Retry with: venice music complete ${queueId} -m ${options.model}`
          ));
        }
      } catch (error) {
        console.error(formatError(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  music
    .command('complete <queueId>')
    .description('Delete stored generated audio after downloading it')
    .option('-m, --model <model>', 'Model used for generation', DEFAULT_MUSIC_MODEL)
    .option('-f, --format <format>', 'Output format (pretty|json)')
    .action(async (queueId: string, options) => {
      const format = detectOutputFormat(options.format);

      try {
        const result = await completeAudioGeneration(queueId, options.model);
        if (format === 'json') {
          console.log(JSON.stringify(result, null, 2));
        } else if (result.success) {
          console.log(formatSuccess('Generated audio removed from remote storage.'));
        } else {
          console.error(formatError('Remote audio cleanup did not complete. Please retry.'));
          process.exitCode = 1;
        }
      } catch (error) {
        console.error(formatError(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  music
    .command('models')
    .description('List available music and sound-effects models')
    .option('-f, --format <format>', 'Output format (pretty|json)')
    .action(async (options) => {
      const format = detectOutputFormat(options.format);
      const c = getChalk();

      try {
        const models = (await listModels())
          .filter((model: Model) => model.type?.toLowerCase() === 'music')
          .sort((a: Model, b: Model) => a.id.localeCompare(b.id));

        if (format === 'json') {
          console.log(JSON.stringify(models, null, 2));
          return;
        }
        if (models.length === 0) {
          console.log(c.yellow('No music models are currently available.'));
          return;
        }

        console.log(c.bold(`Available Music & Sound Effects Models (${models.length})\n`));
        for (const model of models) {
          console.log(`  ${c.cyan(model.id)}`);
          if (model.model_spec?.description) {
            console.log(`    ${c.dim(model.model_spec.description)}`);
          }
        }
      } catch (error) {
        console.error(formatError(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });
}
