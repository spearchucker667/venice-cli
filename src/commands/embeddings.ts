/**
 * Embeddings Command - Generate text embeddings
 */

import { Command } from 'commander';
import * as fs from 'fs';
import { generateEmbeddings } from '../lib/api.js';
import {
  formatSuccess,
  formatError,
  getChalk,
  detectOutputFormat,
} from '../lib/output.js';

export function registerEmbeddingsCommand(program: Command): void {
  program
    .command('embeddings [text...]')
    .alias('embed')
    .description('Generate text embeddings')
    .option('-m, --model <model>', 'Model to use')
    .option('-i, --input <text...>', 'Explicit inputs (preserves multiple inputs)')
    .option('-d, --dimensions <number>', 'Number of dimensions')
    .option('-e, --encoding-format <format>', 'Encoding format (float|base64)')
    .option('-o, --output <path>', 'Save embeddings to JSON file')
    .option('-f, --format <format>', 'Output format (pretty|json)')
    .option('--file <path>', 'Read text from file instead')
    .action(async (textParts: string[], options) => {
      const format = detectOutputFormat(options.format);
      const c = getChalk();

      let input: string | string[];

      // Read from file if specified
      if (options.file) {
        if (!fs.existsSync(options.file)) {
          console.error(formatError(`File not found: ${options.file}`));
          process.exit(1);
        }
        input = fs.readFileSync(options.file, 'utf-8').trim();
      } else if (options.input && options.input.length > 0) {
        input = options.input;
      } else if (textParts.length === 0 && !process.stdin.isTTY) {
        // Read from stdin
        input = await readStdin();
      } else {
        input = textParts.join(' ');
      }

      if (!input || (Array.isArray(input) && input.length === 0)) {
        console.error(formatError('No text provided. Usage: venice embeddings "Your text"'));
        process.exit(1);
      }

      try {
        // VC-KIMI-036: validate numeric/enum arguments before hitting the API.
        const dimensions = options.dimensions !== undefined
          ? parseDimensions(options.dimensions)
          : undefined;
        const encodingFormat = options.encodingFormat !== undefined
          ? parseEncodingFormat(options.encodingFormat)
          : undefined;

        const result = await generateEmbeddings(input, {
          model: options.model,
          dimensions,
          encoding_format: encodingFormat,
        });

        if (options.output) {
          fs.writeFileSync(options.output, JSON.stringify(result, null, 2));
          console.log(formatSuccess(`Saved embeddings to ${options.output}`));
          console.log(c.dim(`Encoding: ${result[0]?.encoding || 'float'}`));
          return;
        }

        if (format === 'json') {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        // Pretty format - show summary (VC-KIMI-035: base64 needs no numeric math).
        for (const item of result) {
          console.log(c.bold(`Embedding ${item.index + 1}:`));
          if (item.encoding === 'base64') {
            const preview = item.embedding.length > 40
              ? `${item.embedding.slice(0, 40)}…`
              : item.embedding;
            console.log(`  ${c.dim('Encoding:')} base64`);
            console.log(`  ${c.dim('Preview:')} ${preview}`);
          } else {
            console.log(`  ${c.dim('Dimension:')} ${item.embedding.length}`);
            console.log(`  ${c.dim('First 5 values:')} [${item.embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);
            console.log(`  ${c.dim('Magnitude:')} ${magnitude(item.embedding).toFixed(6)}`);
          }
        }

        console.log(c.dim('\nTip: Use --output file.json to save full embeddings'));
      } catch (error) {
        console.error(formatError(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });
}

function magnitude(vec: number[]): number {
  return Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
}

function parseDimensions(value: string): number {
  const trimmed = String(value).trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`--dimensions must be a positive integer, got: ${value}`);
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--dimensions must be a positive integer, got: ${value}`);
  }
  return parsed;
}

function parseEncodingFormat(value: string): 'float' | 'base64' {
  const normalized = String(value).trim().toLowerCase();
  if (normalized !== 'float' && normalized !== 'base64') {
    throw new Error(`--encoding-format must be one of: float, base64 (got: ${value})`);
  }
  return normalized;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8').trim();
}
