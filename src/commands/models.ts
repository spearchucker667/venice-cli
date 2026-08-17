/**
 * Models Command - List and filter available models
 */

import { Command, Option } from 'commander';
import { listModels, listModelTraits, listModelCompatibilityMappings } from '../lib/api.js';
import {
  formatError,
  getChalk,
  detectOutputFormat,
} from '../lib/output.js';
import type { Model } from '../types/index.js';
import { isE2EEModel, isTEEModel, modelUsdPrice } from '../types/index.js';

export function registerModelsCommand(program: Command): void {
  const modelsCmd = program
    .command('models')
    .description('List available models')
    .addOption(new Option('-t, --type <type>', 'Filter by type').choices(['all', 'text', 'image', 'tts', 'asr', 'music', 'embedding', 'video', 'upscale', 'inpaint']))
    .option('-s, --search <query>', 'Search models by name')
    .option('--privacy', 'Show only privacy-preserving models')
    .option('-d, --details', 'Show detailed model specs and capabilities')
    .option('-c, --capability <cap>', 'Filter by capability (e.g., vision, webSearch, optimizedForCode, logProbs)')
    .option('--sort <field>', 'Sort models by field (id|context|price)', 'id')
    .option('--tee', 'Show only TEE-attestable models')
    .option('--e2ee', 'Show only E2EE-capable models')
    .option('-f, --format <format>', 'Output format (pretty|json)')
    .action(async (options) => {
      const format = detectOutputFormat(options.format);
      const c = getChalk();

      try {
        let models = applyModelFilters(await listModels(), options);

        // Filter by capability
        if (options.capability) {
          const cap = String(options.capability);
          models = models.filter((m: Model) => {
            const caps = m.model_spec?.capabilities as Record<string, any> || {};
            // check case-insensitively or exactly
            const found = Object.keys(caps).find(k => k.toLowerCase() === cap.toLowerCase() || k.toLowerCase() === `supports${cap.toLowerCase()}`);
            return found ? caps[found] === true : false;
          });
        }

        // Sort
        if (options.sort === 'context') {
          models.sort((a: Model, b: Model) => {
            const ctxA = a.model_spec?.availableContextTokens || 0;
            const ctxB = b.model_spec?.availableContextTokens || 0;
            return ctxB - ctxA; // Descending context window
          });
        } else if (options.sort === 'price') {
          models.sort((a: Model, b: Model) => {
            // VC-KIMI-034: price by input+output USD (per million tokens).
            // Models without token USD pricing sort last.
            const pA = modelUsdPrice(a);
            const pB = modelUsdPrice(b);
            if (pA === undefined && pB === undefined) return 0;
            if (pA === undefined) return 1;
            if (pB === undefined) return -1;
            return pA - pB; // Ascending price
          });
        } else {
          // Sort by id (default)
          models.sort((a: Model, b: Model) => (a.id || '').localeCompare(b.id || ''));
        }

        if (format === 'json') {
          console.log(JSON.stringify(models, null, 2));
          return;
        }

        if (models.length === 0) {
          console.log(c.yellow('No models found matching your criteria.'));
          return;
        }

        console.log(c.bold(`\n📋 Available Models (${models.length})\n`));

        // Group by type
        const grouped = groupModelsByType(models);

        for (const [type, typeModels] of Object.entries(grouped)) {
          console.log(c.bold(`\n${getTypeEmoji(type)} ${capitalizeFirst(type)} Models`));
          console.log(c.dim('─'.repeat(50)));

          for (const model of typeModels) {
            const badges: string[] = [];
            if (isPrivacyPreserving(model)) {
              badges.push(c.green('🔒'));
            }
            if (isE2EEModel(model)) {
              badges.push(c.magenta('🔐'));
            } else if (isTEEModel(model)) {
              badges.push(c.blue('🛡️'));
            }
            if (badges.length === 0) {
              badges.push(c.dim('📊'));
            }

            console.log(`  ${badges.join(' ')} ${c.cyan(model.id)}`);
            if (options.details) {
              const spec = model.model_spec || {};
              const caps = spec.capabilities as Record<string, any> || {};
              const indent = '     ';
              const maxWidth = Math.max(60, (process.stdout.columns || 80) - indent.length - 2);

              if (spec.description) {
                for (const line of wrapText(spec.description, maxWidth)) {
                  console.log(`${indent}${c.dim(line)}`);
                }
              }

              const details = [];
              if (spec.availableContextTokens) details.push(`Context: ${spec.availableContextTokens}`);
              if (caps.supportsVision) details.push('Vision: Yes');
              if (caps.supportsWebSearch) details.push('WebSearch: Yes');
              if (caps.optimizedForCode) details.push('Code: Yes');
              if (caps.supportsFunctionCalling) details.push('Tools: Yes');
              if (caps.supportsCustomDimensions) details.push('Custom Dimensions: Yes');
              if (caps.embeddingDimensions) details.push(`Embedding Dims: ${caps.embeddingDimensions}`);

              if (spec.traits && spec.traits.length > 0) {
                const traitNames = spec.traits.map((t: any) => typeof t === 'string' ? t : t.name).join(', ');
                details.push(`Traits: ${traitNames}`);
              }

              if (details.length > 0) {
                // Split long details lines
                const detailsStr = details.join(' • ');
                for (const line of wrapText(detailsStr, maxWidth - 2)) {
                  console.log(`${indent}${c.green('↳')} ${c.dim(line)}`);
                }
              }
            } else if (model.model_spec?.description) {
              const desc = model.model_spec.description;
              const indent = '     ';
              const maxWidth = Math.max(60, (process.stdout.columns || 80) - indent.length - 2);
              const wrapped = wrapText(desc, maxWidth);
              for (const line of wrapped) {
                console.log(`${indent}${c.dim(line)}`);
              }
            }
          }
        }

        console.log(`\n${c.dim('🔒 = Privacy-preserving    🛡️ = TEE attestation    🔐 = E2EE encrypted')}`);
        console.log(c.dim('📊 = Standard model'));
      } catch (error) {
        console.error(formatError(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  modelsCmd
    .command('traits')
    .description('List model traits')
    .option('-t, --type <type>', 'Filter traits by type (e.g. text)')
    .option('-f, --format <format>', 'Output format (pretty|json)')
    .action(async (options) => {
      const format = detectOutputFormat(options.format);
      const c = getChalk();
      try {
        const traits = await listModelTraits({ type: options.type });
        if (format === 'json') {
          console.log(JSON.stringify(traits, null, 2));
          return;
        }
        if (!traits || (Array.isArray(traits) && traits.length === 0) || Object.keys(traits).length === 0) {
          console.log(c.yellow('No traits found.'));
          return;
        }
        console.log(c.bold(`\n📋 Model Traits\n`));
        if (Array.isArray(traits)) {
          for (const trait of traits) {
            console.log(`  - ${c.cyan(typeof trait === 'string' ? trait : trait.name || JSON.stringify(trait))}`);
          }
        } else {
          for (const [key, value] of Object.entries(traits)) {
            console.log(`  ${c.cyan(key)}: ${value}`);
          }
        }
      } catch (error) {
        console.error(formatError(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  modelsCmd
    .command('mappings')
    .description('List compatibility mappings for models')
    .option('-t, --type <type>', 'Filter mappings by model type (e.g. text)')
    .option('-f, --format <format>', 'Output format (pretty|json)')
    .action(async (options) => {
      const format = detectOutputFormat(options.format);
      const c = getChalk();
      try {
        const mappings = await listModelCompatibilityMappings();
        
        let models = await listModels();
        if (options.type) {
          const requestedType = String(options.type).toLowerCase().trim();
          if (requestedType !== 'all') {
            models = models.filter((m: Model) => m.type?.toLowerCase() === requestedType);
          }
        }
        const validModelIds = new Set(models.map(m => m.id));

        const filteredMappings = Object.entries(mappings).filter(([_alias, targetId]) => {
          if (options.type && options.type.toLowerCase().trim() !== 'all') {
            return validModelIds.has(targetId);
          }
          return true;
        });

        if (format === 'json') {
          console.log(JSON.stringify(Object.fromEntries(filteredMappings), null, 2));
          return;
        }

        if (filteredMappings.length === 0) {
          console.log(c.yellow('No mappings found matching your criteria.'));
          return;
        }

        console.log(c.bold(`\n🔗 Model Compatibility Mappings (${filteredMappings.length})\n`));
        for (const [alias, targetId] of filteredMappings) {
          console.log(`  ${c.cyan(alias)} → ${c.green(targetId)}`);
        }
        console.log('');
      } catch (error) {
        console.error(formatError(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  program.on('command:models', () => {
    if (!process.argv.slice(2).length) {
      modelsCmd.outputHelp();
    }
  });
}

export function applyModelFilters(
  models: Model[],
  options: {
    type?: string;
    search?: string;
    privacy?: boolean;
    tee?: boolean;
    e2ee?: boolean;
  }
): Model[] {
  let filtered = models;

  if (options.type) {
    const requestedType = String(options.type).toLowerCase().trim();
    if (requestedType !== 'all') {
      filtered = filtered.filter((m) => m.type?.toLowerCase() === requestedType);
    }
  }

  if (options.search) {
    const query = options.search.toLowerCase();
    filtered = filtered.filter((m) =>
      m.id?.toLowerCase().includes(query) ||
      m.model_spec?.description?.toLowerCase().includes(query)
    );
  }

  if (options.privacy) {
    filtered = filtered.filter((m) => isPrivacyPreserving(m));
  }

  if (options.tee) {
    filtered = filtered.filter((m) => isTEEModel(m));
  }

  if (options.e2ee) {
    filtered = filtered.filter((m) => isE2EEModel(m));
  }

  return filtered;
}

function groupModelsByType(models: Model[]): Record<string, Model[]> {
  const groups: Record<string, Model[]> = {};

  for (const model of models) {
    let type = 'other';
    const apiType = (model.type || '').toLowerCase();

    // Group strictly by API type families from docs
    if (apiType === 'text') {
      type = 'text';
    } else if (apiType === 'image') {
      type = 'image';
    } else if (apiType === 'inpaint') {
      type = 'inpaint';
    } else if (apiType === 'upscale') {
      type = 'upscale';
    } else if (apiType === 'tts' || apiType === 'asr') {
      type = 'audio';
    } else if (apiType === 'embedding') {
      type = 'embedding';
    } else if (apiType === 'video') {
      type = 'video';
    } else if (apiType === 'music') {
      type = 'music';
    }

    if (!groups[type]) {
      groups[type] = [];
    }
    groups[type].push(model);
  }

  return groups;
}

function getTypeEmoji(type: string): string {
  const emojis: Record<string, string> = {
    text: '💬',
    image: '🖼️',
    inpaint: '🖼️',
    upscale: '🖼️',
    audio: '🎵',
    music: '🎶',
    embedding: '📐',
    video: '🎬',
    other: '📦',
  };
  return emojis[type] || '📦';
}

function isPrivacyPreserving(model: Model): boolean {
  // Current API shape exposes privacy at model_spec.privacy
  // Legacy compatibility: older payloads may have capabilities.privacy
  const privacy = (model.model_spec as { privacy?: string } | undefined)?.privacy;
  if (typeof privacy === 'string') {
    return privacy.toLowerCase() === 'private';
  }

  return Boolean((model.model_spec?.capabilities as { privacy?: boolean } | undefined)?.privacy);
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function wrapText(text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (currentLine.length === 0) {
      currentLine = word;
    } else if (currentLine.length + 1 + word.length <= maxWidth) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines;
}
