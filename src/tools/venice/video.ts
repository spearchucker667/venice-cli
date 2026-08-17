/**
 * Venice-native video tools for the agent runtime.
 */

import * as fs from 'node:fs';
import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';
import type { ToolResult } from '../../agent/types.js';
import {
  completeVideo,
  getVideoStatus,
  queueVideoGeneration,
  retrieveVideo,
  videoUrlFromStatus,
} from '../../lib/api.js';
import { downloadToFile, mimeTypeFromPath, MAX_VIDEO_DOWNLOAD_BYTES, MAX_VIDEO_REFERENCE_IMAGE_BYTES } from '../../lib/media.js';
import { DEFAULT_MODELS } from '../../lib/config.js';
import { waitForVideoStatus, classifyVideoStatus } from '../../commands/video.js';
import { resolveWorkspaceFile } from './io.js';

const DEFAULT_VIDEO_TIMEOUT_MS = 10 * 60 * 1000;

type VideoToolOutput = { queueId: string; model: string; output?: string; status?: string };

export const generateVideoTool: AgentTool<
  {
    prompt: string;
    output?: string;
    model?: string;
    duration?: string;
    aspectRatio?: string;
    wait?: boolean;
    timeoutMs?: number;
  },
  { queueId: string; model: string; output?: string; status?: string }
> = {
  name: 'generate_video',
  description: 'Queue a Venice text-to-video job. Optionally wait and save the result inside the workspace.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string' },
      output: { type: 'string', description: 'Workspace-relative output video path (required when wait is true)' },
      model: { type: 'string' },
      duration: { type: 'string' },
      aspectRatio: { type: 'string' },
      wait: { type: 'boolean' },
      timeoutMs: { type: 'number' },
    },
    required: ['prompt'],
  },
  risk: 'network',
  async execute(input, context) {
    try {
      if (!input.prompt.trim()) {
        return failure('INVALID_VIDEO_PROMPT', 'prompt must be a non-empty string');
      }
      const queued = await queueVideoGeneration(input.prompt, {
        model: input.model,
        duration: input.duration,
        aspectRatio: input.aspectRatio,
      });
      if (!input.wait) {
        return success({ queueId: queued.queue_id, model: queued.model, status: 'queued' });
      }
      return await waitAndSaveVideo(context.workspaceRoot, queued.queue_id, queued.model, input.output, input.timeoutMs);
    } catch (error) {
      return failure('VIDEO_GENERATION_ERROR', error instanceof Error ? error.message : String(error));
    }
  },
};

export const imageToVideoTool: AgentTool<
  {
    image: string;
    prompt: string;
    output?: string;
    model?: string;
    duration?: string;
    aspectRatio?: string;
    wait?: boolean;
    timeoutMs?: number;
  },
  { queueId: string; model: string; output?: string; status?: string }
> = {
  name: 'image_to_video',
  description: 'Queue a Venice image-to-video job from a workspace image. Optionally wait and save the result.',
  inputSchema: {
    type: 'object',
    properties: {
      image: { type: 'string', description: 'Workspace-relative reference image path' },
      prompt: { type: 'string' },
      output: { type: 'string', description: 'Workspace-relative output video path (required when wait is true)' },
      model: { type: 'string' },
      duration: { type: 'string' },
      aspectRatio: { type: 'string' },
      wait: { type: 'boolean' },
      timeoutMs: { type: 'number' },
    },
    required: ['image', 'prompt'],
  },
  risk: 'network',
  async execute(input, context) {
    try {
      if (!input.prompt.trim()) {
        return failure('INVALID_VIDEO_PROMPT', 'prompt must be a non-empty string');
      }
      const source = resolveWorkspaceFile(context.workspaceRoot, input.image, context.workspace?.additionalRoots);
      if (!fs.existsSync(source.absolute)) {
        return failure('IMAGE_NOT_FOUND', `Reference image not found: ${source.relative}`);
      }
      const stats = fs.statSync(source.absolute);
      if (stats.size > MAX_VIDEO_REFERENCE_IMAGE_BYTES) {
        return failure('IMAGE_TOO_LARGE', `Reference image exceeds ${MAX_VIDEO_REFERENCE_IMAGE_BYTES} bytes`);
      }
      const imageData = await fs.promises.readFile(source.absolute);
      const mimeType = mimeTypeFromPath(source.absolute, 'image/png');
      const imageUrl = `data:${mimeType};base64,${imageData.toString('base64')}`;
      const queued = await queueVideoGeneration(input.prompt, {
        model: input.model || DEFAULT_MODELS.imageToVideo,
        duration: input.duration,
        aspectRatio: input.aspectRatio,
        imageUrl,
      });
      if (!input.wait) {
        return success({ queueId: queued.queue_id, model: queued.model, status: 'queued' });
      }
      return await waitAndSaveVideo(context.workspaceRoot, queued.queue_id, queued.model, input.output, input.timeoutMs, context.workspace?.additionalRoots);
    } catch (error) {
      return failure('IMAGE_TO_VIDEO_ERROR', error instanceof Error ? error.message : String(error));
    }
  },
};

async function waitAndSaveVideo(
  workspaceRoot: string,
  queueId: string,
  model: string,
  outputPath: string | undefined,
  timeoutMs: number | undefined,
  additionalRoots?: string[]
): Promise<ToolResult<VideoToolOutput>> {
  if (!outputPath?.trim()) {
    return failure('MISSING_OUTPUT', 'output is required when wait is true');
  }

  const dest = resolveWorkspaceFile(workspaceRoot, outputPath, additionalRoots);
  const status = await waitForVideoStatus(
    () => getVideoStatus(queueId, model),
    timeoutMs && timeoutMs > 0 ? timeoutMs : DEFAULT_VIDEO_TIMEOUT_MS
  );

  if (classifyVideoStatus(status.status) === 'failed') {
    return failure('VIDEO_FAILED', status.error || `Video generation failed with status "${status.status}"`);
  }

  const result = await retrieveVideo(queueId, model, {
    outputPath: dest.absolute,
    maxBytes: MAX_VIDEO_DOWNLOAD_BYTES,
  });

  if (result.kind === 'status') {
    const downloadUrl = videoUrlFromStatus(result.status);
    if (!downloadUrl) {
      return failure('VIDEO_NOT_READY', result.status.error || 'Video completed but no download URL was returned.');
    }
    await downloadToFile(downloadUrl, dest.absolute, {
      maxBytes: MAX_VIDEO_DOWNLOAD_BYTES,
      expectedContentTypePrefixes: ['video/'],
    });
  }

  try {
    await completeVideo(queueId, model);
  } catch {
    // Cleanup is best-effort after a successful download.
  }

  return success(
    { queueId, model, output: dest.relative, status: 'completed' },
    { affectedFiles: [dest.relative] }
  );
}
