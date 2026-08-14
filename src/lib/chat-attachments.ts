import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import {
  MAX_CHAT_AUDIO_BYTES,
  MAX_CHAT_FILE_BYTES,
  MAX_CHAT_IMAGE_BYTES,
  MAX_CHAT_VIDEO_BYTES,
  assertFileSizeWithinLimit,
  audioFormatFromPath,
  downloadToBuffer,
  readFileAsBase64,
  readFileAsDataUrl,
} from './media.js';
import type {
  ContentPart,
  FileContentPart,
  ImageUrlContentPart,
  InputAudioContentPart,
  MessageContent,
  Model,
  VideoUrlContentPart,
} from '../types/index.js';
import {
  supportsAudioInput,
  supportsMultipleImages,
  supportsVideoInput,
  supportsVision,
} from '../types/index.js';

export interface ChatAttachments {
  images: string[];
  files: string[];
  audio: string[];
  videos: string[];
}

export function collectOptionValue(value: string, previous: string[] = []): string[] {
  return previous.concat(value);
}

export function parseChatAttachments(options: {
  image?: string[];
  file?: string[];
  audio?: string[];
  video?: string[];
}): ChatAttachments {
  return {
    images: options.image ?? [],
    files: options.file ?? [],
    audio: options.audio ?? [],
    videos: options.video ?? [],
  };
}

export function hasChatAttachments(attachments: ChatAttachments): boolean {
  return (
    attachments.images.length +
    attachments.files.length +
    attachments.audio.length +
    attachments.videos.length
  ) > 0;
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isRemoteOrDataUrl(value: string): boolean {
  return isHttpUrl(value) || value.startsWith('data:');
}

export function assertLocalAttachmentFiles(attachments: ChatAttachments): void {
  for (const image of attachments.images) {
    assertLocalSource(image, MAX_CHAT_IMAGE_BYTES, 'Image');
  }
  for (const file of attachments.files) {
    assertLocalSource(file, MAX_CHAT_FILE_BYTES, 'File');
  }
  for (const audio of attachments.audio) {
    assertLocalSource(audio, MAX_CHAT_AUDIO_BYTES, 'Audio');
  }
  for (const video of attachments.videos) {
    assertLocalSource(video, MAX_CHAT_VIDEO_BYTES, 'Video');
  }
}

function assertLocalSource(source: string, maxBytes: number, label: string): void {
  if (isRemoteOrDataUrl(source)) {
    return;
  }
  if (!existsSync(source)) {
    throw new Error(`${label} not found: ${source}`);
  }
  assertFileSizeWithinLimit(source, maxBytes, label);
}

export function assertAttachmentCapabilities(model: Model, attachments: ChatAttachments): void {
  const modelId = model.id;
  const imageCount = attachments.images.length;
  const audioCount = attachments.audio.length;
  const videoCount = attachments.videos.length;

  if (imageCount > 0 && !supportsVision(model)) {
    throw new Error(`Model "${modelId}" does not support image inputs (supportsVision).`);
  }

  if (imageCount > 1) {
    if (!supportsMultipleImages(model)) {
      throw new Error(`Model "${modelId}" does not support multiple images (supportsMultipleImages).`);
    }
    const maxImages = model.model_spec?.capabilities?.maxImages;
    if (typeof maxImages === 'number' && imageCount > maxImages) {
      throw new Error(`Model "${modelId}" accepts at most ${maxImages} images per request.`);
    }
  }

  if (audioCount > 0 && !supportsAudioInput(model)) {
    throw new Error(`Model "${modelId}" does not support audio inputs (supportsAudioInput).`);
  }

  if (videoCount > 0 && !supportsVideoInput(model)) {
    throw new Error(`Model "${modelId}" does not support video inputs (supportsVideoInput).`);
  }

  if (videoCount > 0) {
    const maxVideos = model.model_spec?.capabilities?.maxVideos;
    const limit = typeof maxVideos === 'number' ? maxVideos : 3;
    if (videoCount > limit) {
      throw new Error(`At most ${limit} videos may be attached per request.`);
    }
  }
}

export function assertAttachmentsAllowedForPrivacy(useE2EE: boolean, useTEE: boolean): void {
  if (useE2EE || useTEE) {
    throw new Error(
      'Multimodal attachments are not supported with E2EE or TEE. ' +
      'Use a standard chat model, or omit --image/--file/--audio/--video.'
    );
  }
}

export async function buildUserMessageContent(
  prompt: string,
  attachments: ChatAttachments
): Promise<MessageContent> {
  const parts: ContentPart[] = [];
  if (prompt.trim()) {
    parts.push({ type: 'text', text: prompt });
  }

  for (const image of attachments.images) {
    parts.push(await buildImagePart(image));
  }
  for (const file of attachments.files) {
    parts.push(await buildFilePart(file));
  }
  for (const audio of attachments.audio) {
    parts.push(await buildAudioPart(audio));
  }
  for (const video of attachments.videos) {
    parts.push(await buildVideoPart(video));
  }

  if (parts.length === 0) {
    throw new Error('No prompt or attachments provided.');
  }
  if (parts.length === 1 && parts[0].type === 'text') {
    return parts[0].text;
  }
  return parts;
}

async function buildImagePart(source: string): Promise<ImageUrlContentPart> {
  if (isRemoteOrDataUrl(source)) {
    return { type: 'image_url', image_url: { url: source } };
  }
  const file = readFileAsDataUrl(source, MAX_CHAT_IMAGE_BYTES, 'Image');
  return { type: 'image_url', image_url: { url: file.dataUrl } };
}

async function buildFilePart(source: string): Promise<FileContentPart> {
  if (isRemoteOrDataUrl(source)) {
    return {
      type: 'file',
      file: {
        file_data: source,
        filename: filenameFromSource(source),
      },
    };
  }
  const file = readFileAsDataUrl(source, MAX_CHAT_FILE_BYTES, 'File');
  return {
    type: 'file',
    file: {
      file_data: file.dataUrl,
      filename: file.filename,
    },
  };
}

async function buildAudioPart(source: string): Promise<InputAudioContentPart> {
  if (source.startsWith('data:')) {
    const parsed = parseDataUrl(source);
    return {
      type: 'input_audio',
      input_audio: {
        data: parsed.base64,
        format: audioFormatFromMime(parsed.mimeType),
      },
    };
  }

  if (isHttpUrl(source)) {
    const downloaded = await downloadToBuffer(source, { maxBytes: MAX_CHAT_AUDIO_BYTES });
    return {
      type: 'input_audio',
      input_audio: {
        data: downloaded.buffer.toString('base64'),
        format: audioFormatFromMime(downloaded.contentType) || audioFormatFromPath(source),
      },
    };
  }

  const file = readFileAsBase64(source, MAX_CHAT_AUDIO_BYTES, 'Audio');
  return {
    type: 'input_audio',
    input_audio: {
      data: file.base64,
      format: audioFormatFromPath(source),
    },
  };
}

async function buildVideoPart(source: string): Promise<VideoUrlContentPart> {
  if (isRemoteOrDataUrl(source)) {
    return { type: 'video_url', video_url: { url: source } };
  }
  const file = readFileAsDataUrl(source, MAX_CHAT_VIDEO_BYTES, 'Video');
  return { type: 'video_url', video_url: { url: file.dataUrl } };
}

function filenameFromSource(source: string): string | undefined {
  if (source.startsWith('data:')) {
    return undefined;
  }
  try {
    const url = new URL(source);
    const name = basename(url.pathname);
    return name || undefined;
  } catch {
    return basename(source) || undefined;
  }
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const match = dataUrl.match(/^data:([^;,]+)?(?:;base64)?,([\s\S]*)$/);
  if (!match) {
    throw new Error('Invalid data URL for audio input.');
  }
  return {
    mimeType: match[1] || 'application/octet-stream',
    base64: match[2] || '',
  };
}

function audioFormatFromMime(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3';
  if (normalized.includes('aiff')) return 'aiff';
  if (normalized.includes('aac')) return 'aac';
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('flac')) return 'flac';
  if (normalized.includes('mp4') || normalized.includes('m4a')) return 'm4a';
  return 'wav';
}
