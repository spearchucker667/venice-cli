/**
 * Venice-native audio tools for the agent runtime.
 */

import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';
import { textToSpeech, transcribe, queueAudioGeneration, retrieveGeneratedAudio, completeAudioGeneration } from '../../lib/api.js';
import { DEFAULT_MODELS } from '../../lib/config.js';
import { resolveWorkspaceFile, writeWorkspaceBytes } from './io.js';
import { writeResponseToFile, MAX_AUDIO_DOWNLOAD_BYTES } from '../../lib/media.js';

const POLL_INTERVAL_MS = 5000;
const DEFAULT_AUDIO_TIMEOUT_MS = 10 * 60 * 1000;

export const textToSpeechTool: AgentTool<
  {
    text: string;
    output: string;
    model?: string;
    voice?: string;
    format?: 'mp3' | 'wav' | 'opus' | 'aac' | 'flac' | 'pcm';
    speed?: number;
    temperature?: number;
  },
  string
> = {
  name: 'text_to_speech',
  description: 'Synthesize speech with the Venice TTS API and save it inside the workspace.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      output: { type: 'string', description: 'Workspace-relative output audio path' },
      model: { type: 'string' },
      voice: { type: 'string' },
      format: { type: 'string', enum: ['mp3', 'wav', 'opus', 'aac', 'flac', 'pcm'] },
      speed: { type: 'number' },
      temperature: { type: 'number' },
    },
    required: ['text', 'output'],
  },
  risk: 'network',
  async execute(input, context) {
    try {
      if (!input.text.trim()) {
        return failure('INVALID_TTS_TEXT', 'text must be a non-empty string');
      }
      const result = await textToSpeech(input.text, {
        model: input.model,
        voice: input.voice,
        format: input.format,
        speed: input.speed,
        temperature: input.temperature,
      });
      const { relative } = writeWorkspaceBytes(context.workspaceRoot, input.output, result.audio, context.workspace?.additionalRoots);
      return success(relative, { affectedFiles: [relative] });
    } catch (error) {
      return failure('TTS_ERROR', error instanceof Error ? error.message : String(error));
    }
  },
};

export const transcribeAudioTool: AgentTool<
  { audio: string; model?: string; language?: string; timestamps?: boolean },
  { text: string; duration?: number }
> = {
  name: 'transcribe_audio',
  description: 'Transcribe a workspace audio file using the Venice ASR API.',
  inputSchema: {
    type: 'object',
    properties: {
      audio: { type: 'string', description: 'Workspace-relative audio path' },
      model: { type: 'string' },
      language: { type: 'string' },
      timestamps: { type: 'boolean' },
    },
    required: ['audio'],
  },
  risk: 'network',
  async execute(input, context) {
    try {
      const source = resolveWorkspaceFile(context.workspaceRoot, input.audio, context.workspace?.additionalRoots);
      const result = await transcribe(source.absolute, {
        model: input.model,
        language: input.language,
        timestamps: input.timestamps,
      });
      return success({ text: result.text, duration: result.duration });
    } catch (error) {
      return failure('TRANSCRIBE_ERROR', error instanceof Error ? error.message : String(error));
    }
  },
};

function extensionForContentType(contentType: string): string {
  const extensions: Record<string, string> = {
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/flac': '.flac',
  };
  return extensions[contentType] || '.bin';
}

export const generateMusicTool: AgentTool<
  {
    prompt: string;
    model?: string;
    duration?: number;
    lyricsPrompt?: string;
    forceInstrumental?: boolean;
    output?: string;
    wait?: boolean;
    timeoutMs?: number;
  },
  { queueId: string; model: string; output?: string; status?: string }
> = {
  name: 'generate_music',
  description: 'Queue a Venice music/audio generation job. Optionally wait and save the result inside the workspace.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string' },
      model: { type: 'string' },
      duration: { type: 'number' },
      lyricsPrompt: { type: 'string' },
      forceInstrumental: { type: 'boolean' },
      output: { type: 'string', description: 'Workspace-relative output path (required when wait is true)' },
      wait: { type: 'boolean' },
      timeoutMs: { type: 'number' },
    },
    required: ['prompt'],
  },
  risk: 'network',
  async execute(input, context) {
    try {
      if (!input.prompt.trim()) {
        return failure('INVALID_AUDIO_PROMPT', 'prompt must be a non-empty string');
      }

      const queued = await queueAudioGeneration(input.prompt, {
        model: input.model || DEFAULT_MODELS.music,
        durationSeconds: input.duration,
        lyricsPrompt: input.lyricsPrompt,
        forceInstrumental: input.forceInstrumental,
      });

      if (!input.wait) {
        return success({ queueId: queued.queue_id, model: queued.model, status: 'queued' });
      }

      if (!input.output?.trim()) {
        return failure('MISSING_OUTPUT', 'output is required when wait is true');
      }

      let timeoutMs = input.timeoutMs && input.timeoutMs > 0 ? input.timeoutMs : DEFAULT_AUDIO_TIMEOUT_MS;
      const start = Date.now();
      
      while (true) {
        if (Date.now() - start > timeoutMs) {
          return failure('TIMEOUT', `Audio generation timed out after ${timeoutMs}ms`);
        }

        const result = await retrieveGeneratedAudio(queued.queue_id, queued.model);
        if (result.kind === 'audio') {
          const extension = extensionForContentType(result.contentType);
          let finalOutput = input.output;
          if (!finalOutput.endsWith(extension) && !finalOutput.endsWith('.bin')) {
             finalOutput += extension;
          }
          const dest = resolveWorkspaceFile(context.workspaceRoot, finalOutput, context.workspace?.additionalRoots);
          
          await writeResponseToFile(result.response, dest.absolute, {
            maxBytes: MAX_AUDIO_DOWNLOAD_BYTES,
            expectedContentTypePrefixes: ['audio/'],
          });

          try {
            await completeAudioGeneration(queued.queue_id, queued.model);
          } catch {}

          return success(
            { queueId: queued.queue_id, model: queued.model, output: dest.relative, status: 'completed' },
            { affectedFiles: [dest.relative] }
          );
        }

        const statusLower = result.status.status.toLowerCase();
        if (statusLower === 'failed') {
          return failure('GENERATION_FAILED', result.status.error || 'Audio generation failed');
        }

        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    } catch (error) {
      return failure('AUDIO_GENERATION_ERROR', error instanceof Error ? error.message : String(error));
    }
  },
};
