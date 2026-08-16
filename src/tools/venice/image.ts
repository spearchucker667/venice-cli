/**
 * Venice-native image generation tool for the agent runtime.
 */

import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';
import { editImage, generateImage, removeImageBackground, upscaleImage } from '../../lib/api.js';
import { imageFormatForPath, inspectImageArtifact, resolveWorkspaceFile, writeWorkspaceBytes, type ImageArtifact } from './io.js';

export const generateImageTool: AgentTool<
  { prompt: string; output: string; model?: string; width?: number; height?: number; count?: number; format?: 'png' | 'jpeg' | 'webp' },
  ImageArtifact[]
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
      format: { type: 'string', enum: ['png', 'jpeg', 'webp'], description: 'Requested image encoding; must match the output extension' },
    },
    required: ['prompt', 'output'],
  },
  risk: 'network',
  async execute(input, context) {
    try {
      const outputFormat = imageFormatForPath(input.output);
      if (!outputFormat) return failure('INVALID_IMAGE_OUTPUT', 'Output must end in .png, .jpg, .jpeg, or .webp');
      if (input.format && input.format !== outputFormat) {
        return failure('IMAGE_FORMAT_MISMATCH', `Requested ${input.format} but output path expects ${outputFormat}`);
      }
      const images = await generateImage(input.prompt, {
        model: input.model,
        width: input.width,
        height: input.height,
        count: input.count,
        format: input.format ?? outputFormat,
      });

      const bytes = Buffer.from(images[0], 'base64');
      const artifact = inspectImageArtifact(input.output, bytes);
      const { relative } = writeWorkspaceBytes(
        context.workspaceRoot,
        input.output,
        bytes
      );

      return success([{ ...artifact, path: relative }], { affectedFiles: [relative] });
    } catch (error) {
      return failure('IMAGE_GENERATION_ERROR', error instanceof Error ? error.message : String(error));
    }
  },
};

export const editImageTool: AgentTool<
  { image: string; prompt: string; output: string; model?: string; aspectRatio?: string; enhancePrompt?: boolean; safeMode?: boolean },
  string
> = {
  name: 'edit_image',
  description: 'Edit a workspace image with a text prompt using the Venice image edit API.',
  inputSchema: {
    type: 'object',
    properties: {
      image: { type: 'string', description: 'Workspace-relative input image path' },
      prompt: { type: 'string' },
      output: { type: 'string', description: 'Workspace-relative output image path' },
      model: { type: 'string' },
      aspectRatio: { type: 'string' },
      enhancePrompt: { type: 'boolean' },
      safeMode: { type: 'boolean' },
    },
    required: ['image', 'prompt', 'output'],
  },
  risk: 'network',
  async execute(input, context) {
    try {
      const source = resolveWorkspaceFile(context.workspaceRoot, input.image);
      const bytes = await editImage(source.absolute, input.prompt, {
        model: input.model,
        aspectRatio: input.aspectRatio,
        enhancePrompt: input.enhancePrompt,
        safeMode: input.safeMode,
      });
      inspectImageArtifact(input.output, bytes);
      const { relative } = writeWorkspaceBytes(context.workspaceRoot, input.output, bytes);
      return success(relative, { affectedFiles: [relative] });
    } catch (error) {
      return failure('IMAGE_EDIT_ERROR', error instanceof Error ? error.message : String(error));
    }
  },
};

export const upscaleImageTool: AgentTool<
  { image: string; output: string; model?: string; scale?: number },
  string
> = {
  name: 'upscale_image',
  description: 'Upscale a workspace image using the Venice image upscale API.',
  inputSchema: {
    type: 'object',
    properties: {
      image: { type: 'string', description: 'Workspace-relative input image path' },
      output: { type: 'string', description: 'Workspace-relative output image path' },
      model: { type: 'string' },
      scale: { type: 'number', description: 'Scale factor (2 or 4)' },
    },
    required: ['image', 'output'],
  },
  risk: 'network',
  async execute(input, context) {
    try {
      const scale = input.scale ?? 2;
      if (scale !== 2 && scale !== 4) {
        return failure('INVALID_SCALE', 'Scale must be either 2 or 4');
      }
      const source = resolveWorkspaceFile(context.workspaceRoot, input.image);
      const result = await upscaleImage(source.absolute, { model: input.model, scale });
      inspectImageArtifact(input.output, result.bytes);
      const { relative } = writeWorkspaceBytes(context.workspaceRoot, input.output, result.bytes);
      return success(relative, { affectedFiles: [relative] });
    } catch (error) {
      return failure('IMAGE_UPSCALE_ERROR', error instanceof Error ? error.message : String(error));
    }
  },
};

export const removeBackgroundTool: AgentTool<
  { image: string; output: string },
  string
> = {
  name: 'remove_background',
  description: 'Remove the background from a workspace image using the Venice background-remove API.',
  inputSchema: {
    type: 'object',
    properties: {
      image: { type: 'string', description: 'Workspace-relative input image path' },
      output: { type: 'string', description: 'Workspace-relative output image path' },
    },
    required: ['image', 'output'],
  },
  risk: 'network',
  async execute(input, context) {
    try {
      const source = resolveWorkspaceFile(context.workspaceRoot, input.image);
      const bytes = await removeImageBackground(source.absolute);
      inspectImageArtifact(input.output, bytes);
      const { relative } = writeWorkspaceBytes(context.workspaceRoot, input.output, bytes);
      return success(relative, { affectedFiles: [relative] });
    } catch (error) {
      return failure('IMAGE_BG_REMOVE_ERROR', error instanceof Error ? error.message : String(error));
    }
  },
};
