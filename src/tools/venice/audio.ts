/**
 * Venice-native audio tools for the agent runtime.
 */

import type { AgentTool } from '../types.js';
import { success, failure } from '../result.js';
import { textToSpeech, transcribe } from '../../lib/api.js';
import { resolveWorkspaceFile, writeWorkspaceBytes } from './io.js';

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
      const { relative } = writeWorkspaceBytes(context.workspaceRoot, input.output, result.audio);
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
      const source = resolveWorkspaceFile(context.workspaceRoot, input.audio);
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
