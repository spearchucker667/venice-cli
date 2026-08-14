/**
 * Image Command - Generate and manipulate images
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import {
  editImage,
  generateImage,
  listImageStyles,
  multiEditImage,
  removeImageBackground,
  upscaleImage,
} from '../lib/api.js';
import { downloadToFile, MAX_IMAGE_DOWNLOAD_BYTES } from '../lib/media.js';
import { getDefaultImageModel } from '../lib/config.js';
import {
  formatSuccess,
  formatError,
  getChalk,
  detectOutputFormat,
} from '../lib/output.js';

export function registerImageCommand(program: Command): void {
  // Generate image
  program
    .command('image <prompt...>')
    .description('Generate an image from a text prompt')
    .option('-m, --model <model>', 'Model to use')
    .option('-o, --output <path>', 'Save image to file')
    .option('-w, --width <pixels>', 'Image width', '1024')
    .option('-h, --height <pixels>', 'Image height', '1024')
    .option('-n, --count <number>', 'Number of images to generate', '1')
    .option('--style <preset>', 'Image style preset')
    .option('-f, --format <format>', 'Output format (pretty|json)')
    .action(async (promptParts: string[], options) => {
      const prompt = promptParts.join(' ');
      const model = options.model || getDefaultImageModel();
      const format = detectOutputFormat(options.format);

      const width = parseInt(options.width, 10);
      const height = parseInt(options.height, 10);
      const count = parseInt(options.count, 10);

      if (isNaN(width) || width < 64 || width > 4096) {
        console.error(formatError('Width must be a number between 64 and 4096'));
        process.exit(1);
      }
      if (isNaN(height) || height < 64 || height > 4096) {
        console.error(formatError('Height must be a number between 64 and 4096'));
        process.exit(1);
      }
      if (isNaN(count) || count < 1 || count > 10) {
        console.error(formatError('Count must be a number between 1 and 10'));
        process.exit(1);
      }

      try {
        const images = await generateImage(prompt, {
          model,
          width,
          height,
          n: count,
          stylePreset: options.style,
        });

        if (format === 'json') {
          console.log(JSON.stringify({ images: images.map(b64 => ({ b64_json: b64 })) }, null, 2));
          return;
        }

        for (let i = 0; i < images.length; i++) {
          const imageData = Buffer.from(images[i], 'base64');

          let outputPath = options.output || `image_${Date.now()}.png`;
          if (images.length > 1) {
            const ext = path.extname(outputPath);
            const base = path.basename(outputPath, ext);
            const dir = path.dirname(outputPath);
            outputPath = path.join(dir, `${base}_${i + 1}${ext}`);
          }

          fs.writeFileSync(outputPath, imageData);
          console.log(formatSuccess(`Saved to ${outputPath}`));
        }
      } catch (error) {
        console.error(formatError(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  program
    .command('image-edit <image> <prompt...>')
    .description('Edit a local image using a text prompt')
    .option('-m, --model <model>', 'Edit model to use')
    .option('-o, --output <path>', 'Save result to file')
    .option('-a, --aspect-ratio <ratio>', 'Output aspect ratio (for example, 16:9 or auto)')
    .option('--enhance-prompt', 'Enhance the prompt using the input image')
    .option('--no-safe-mode', 'Disable adult-content blurring')
    .option('-f, --format <format>', 'Output format (pretty|json)')
    .action(async (imagePath: string, promptParts: string[], options) => {
      const format = detectOutputFormat(options.format);
      try {
        const result = await editImage(path.resolve(imagePath), promptParts.join(' '), {
          model: options.model,
          aspectRatio: options.aspectRatio,
          enhancePrompt: options.enhancePrompt,
          safeMode: options.safeMode,
        });
        writeImageResult(result, options.output || `edited_${Date.now()}.png`, format, 'edited image');
      } catch (error) {
        console.error(formatError(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  program
    .command('image-multi-edit <images...>')
    .description('Edit using one to three local image layers')
    .requiredOption('-p, --prompt <prompt>', 'Edit instructions')
    .option('-m, --model <model>', 'Edit model to use')
    .option('-o, --output <path>', 'Save result to file')
    .option('-a, --aspect-ratio <ratio>', 'Output aspect ratio (for example, 16:9 or auto)')
    .option('--enhance-prompt', 'Enhance the prompt using the input images')
    .option('--no-safe-mode', 'Disable adult-content blurring')
    .option('-f, --format <format>', 'Output format (pretty|json)')
    .action(async (imagePaths: string[], options) => {
      const format = detectOutputFormat(options.format);
      try {
        const result = await multiEditImage(
          imagePaths.map(imagePath => path.resolve(imagePath)),
          options.prompt,
          {
            model: options.model,
            aspectRatio: options.aspectRatio,
            enhancePrompt: options.enhancePrompt,
            safeMode: options.safeMode,
          }
        );
        writeImageResult(result, options.output || `multi_edited_${Date.now()}.png`, format, 'edited image');
      } catch (error) {
        console.error(formatError(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  program
    .command('image-bg-remove <image>')
    .description('Remove the background from a local image')
    .option('-o, --output <path>', 'Save result to file')
    .option('-f, --format <format>', 'Output format (pretty|json)')
    .action(async (imagePath: string, options) => {
      const format = detectOutputFormat(options.format);
      try {
        const result = await removeImageBackground(path.resolve(imagePath));
        writeImageResult(result, options.output || `cutout_${Date.now()}.png`, format, 'cutout');
      } catch (error) {
        console.error(formatError(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  program
    .command('image-styles')
    .description('List available image style presets')
    .option('-f, --format <format>', 'Output format (pretty|json)')
    .action(async (options) => {
      const format = detectOutputFormat(options.format);
      try {
        const styles = await listImageStyles();
        if (format === 'json') {
          console.log(JSON.stringify({ data: styles, object: 'list' }, null, 2));
        } else {
          console.log(styles.join('\n'));
        }
      } catch (error) {
        console.error(formatError(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });

  // Upscale image
  program
    .command('upscale <image>')
    .description('Upscale an image')
    .option('-m, --model <model>', 'Model to use')
    .option('-s, --scale <factor>', 'Scale factor (2 or 4)', '2')
    .option('-o, --output <path>', 'Save result to file')
    .option('-f, --format <format>', 'Output format (pretty|json)')
    .action(async (imagePath: string, options) => {
      const format = detectOutputFormat(options.format);
      const c = getChalk();

      const scale = parseInt(options.scale, 10);
      if (isNaN(scale) || (scale !== 2 && scale !== 4)) {
        console.error(formatError('Scale must be either 2 or 4'));
        process.exit(1);
      }

      const resolvedPath = path.resolve(imagePath);
      
      if (!fs.existsSync(resolvedPath)) {
        console.error(formatError(`File not found: ${imagePath}`));
        process.exit(1);
      }

      try {
        const result = await upscaleImage(resolvedPath, {
          model: options.model,
          scale,
        });

        if (format === 'json') {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (options.output) {
          await downloadToFile(result.url, options.output, {
            maxBytes: MAX_IMAGE_DOWNLOAD_BYTES,
            expectedContentTypePrefixes: ['image/'],
          });
          console.log(formatSuccess(`Saved upscaled image to ${options.output}`));
        } else {
          console.log(`${c.cyan('🖼️  Upscaled URL:')} ${result.url}`);
        }
      } catch (error) {
        console.error(formatError(error instanceof Error ? error.message : String(error)));
        process.exit(1);
      }
    });
}

function writeImageResult(
  result: ArrayBuffer,
  outputPath: string,
  format: string,
  label: string
): void {
  const imageData = Buffer.from(result);
  if (format === 'json') {
    console.log(JSON.stringify({ image: { b64_json: imageData.toString('base64') } }, null, 2));
    return;
  }

  fs.writeFileSync(outputPath, imageData);
  console.log(formatSuccess(`Saved ${label} to ${outputPath}`));
}
