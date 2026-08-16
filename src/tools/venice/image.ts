/**
 * Venice-native image generation tool for the agent runtime.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';
import { generateImage } from '../../lib/api.js';
import { WorkspaceManager } from '../../agent/workspace.js';

export const generateImageTool: AgentTool<
  { prompt: string; output: string; model?: string; width?: number; height?: number; count?: number },
  string[]
> = {
  name: 'generate_image',
  description: 'Generate an image using the Venice image API and save it inside the workspace.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string' },
      output: { type: 'string', description: 'Workspace-relative path for the output image (png/jpeg/webp)' },
      model: { type: 'string' },
      width: { type: 'number' },
      height: { type: 'number' },
      count: { type: 'number' },
    },
    required: ['prompt', 'output'],
  },
  risk: 'network',
  async execute(input, context) {
    const workspace = new WorkspaceManager(context.workspaceRoot);
    try {
      const images = await generateImage(input.prompt, {
        model: input.model,
        width: input.width,
        height: input.height,
        count: input.count,
      });

      const { absolute, relative } = workspace.resolve(input.output);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });

      // Venice returns base64-encoded PNGs by default.
      const buffer = Buffer.from(images[0], 'base64');
      fs.writeFileSync(absolute, buffer);

      return success([relative], { affectedFiles: [relative] });
    } catch (error) {
      return failure('IMAGE_GENERATION_ERROR', error instanceof Error ? error.message : String(error));
    }
  },
};
