/**
 * Characters Command - List and inspect Venice API characters
 */

import { Command } from 'commander';
import { getCharacter, getCharacterReviews, listCharacters } from '../lib/api.js';
import { formatError, getChalk, detectOutputFormat } from '../lib/output.js';
import type { Character, CharacterReviewsPage } from '../types/index.js';

export function registerCharactersCommand(program: Command): void {
  const characters = program
    .command('characters')
    .description('List characters from the Venice API catalog')
    .option('-s, --search <query>', 'Search by name, description, or tags')
    .option('--limit <n>', 'Number of characters to return (max 100)', '50')
    .option('--offset <n>', 'Number of characters to skip', '0')
    .option('-f, --format <format>', 'Output format (pretty|json)')
    .action(async (options) => {
      const format = detectOutputFormat(options.format);
      const c = getChalk();

      try {
        const results = await listCharacters({
          search: options.search,
          limit: parseInt(options.limit, 10),
          offset: parseInt(options.offset, 10),
        });

        if (format === 'json') {
          console.log(JSON.stringify(results, null, 2));
          return;
        }

        if (results.length === 0) {
          console.log(c.yellow('No characters found matching your criteria.'));
          return;
        }

        console.log(c.bold(`\n🎭 Characters (${results.length})\n`));
        console.log(c.dim('Use a slug with: venice chat -c <slug> "Your message"\n'));

        for (const character of results) {
          printCharacterSummary(character);
        }
      } catch (error) {
        console.error(formatError(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  characters
    .command('show <slug>')
    .description('Show details for a character slug')
    .option('-f, --format <format>', 'Output format (pretty|json)')
    .action(async (slug: string, options) => {
      const format = detectOutputFormat(options.format);
      const c = getChalk();

      try {
        const character = await getCharacter(slug);
        const reviews = await fetchReviewsOptional(slug);

        if (format === 'json') {
          console.log(JSON.stringify({ ...character, reviews }, null, 2));
          return;
        }

        printCharacterDetails(character);

        if (reviews && reviews.data.length > 0) {
          console.log(c.bold('Reviews'));
          console.log(c.dim('─'.repeat(50)));
          console.log(
            c.dim(
              `Average ${reviews.summary.averageRating} · ${reviews.summary.totalReviews} review${reviews.summary.totalReviews === 1 ? '' : 's'}`
            )
          );
          console.log('');

          for (const review of reviews.data) {
            const stars = '★'.repeat(review.rating) + '☆'.repeat(Math.max(0, 5 - review.rating));
            console.log(`  ${c.yellow(stars)}  ${c.cyan(review.username)}`);
            if (review.message) {
              console.log(`    ${review.message}`);
            }
            console.log('');
          }
        }

        console.log(c.dim(`Usage: venice chat -c ${character.slug} "Your message"`));
      } catch (error) {
        console.error(formatError(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });
}

async function fetchReviewsOptional(slug: string): Promise<CharacterReviewsPage | undefined> {
  try {
    return await getCharacterReviews(slug);
  } catch {
    return undefined;
  }
}

function printCharacterSummary(character: Character): void {
  const c = getChalk();
  const featured = character.featured ? ` ${c.yellow('★')}` : '';
  console.log(`${c.cyan(c.bold(character.slug))} — ${character.name}${featured}`);
  if (character.description) {
    console.log(`  ${c.dim(truncate(character.description, 140))}`);
  }
  if (character.tags?.length) {
    console.log(`  ${c.dim(character.tags.slice(0, 6).join(', '))}`);
  }
  console.log('');
}

function printCharacterDetails(character: Character): void {
  const c = getChalk();

  console.log('');
  console.log(`${c.cyan(c.bold(character.slug))} — ${c.bold(character.name)}`);
  console.log('');

  if (character.description) {
    console.log(character.description);
    console.log('');
  }

  if (character.tags?.length) {
    console.log(`${c.dim('Tags:')} ${character.tags.join(', ')}`);
  }
  if (character.modelId) {
    console.log(`${c.dim('Model:')} ${character.modelId}`);
  }
  if (character.stats) {
    console.log(
      `${c.dim('Rating:')} ${character.stats.averageRating} (${character.stats.ratingCount} ratings)`
    );
  }
  console.log(`${c.dim('Featured:')} ${character.featured ? 'yes' : 'no'}`);
  console.log(`${c.dim('Adult:')} ${character.adult ? 'yes' : 'no'}`);
  if (character.shareUrl) {
    console.log(`${c.dim('Share:')} ${character.shareUrl}`);
  }
  console.log('');
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}
