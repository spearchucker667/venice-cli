/**
 * Venice CLI Type Definitions
 */

export interface VeniceConfig {
  api_key?: string;
  default_model?: string;
  default_image_model?: string;
  default_voice?: string;
  output_format?: OutputFormat;
  no_color?: boolean;
  show_usage?: boolean;
}

export type OutputFormat = 'pretty' | 'json' | 'markdown' | 'raw';

export interface TextContentPart {
  type: 'text';
  text: string;
}

export interface ImageUrlContentPart {
  type: 'image_url';
  image_url: { url: string };
}

export interface InputAudioContentPart {
  type: 'input_audio';
  input_audio: { data: string; format: string };
}

export interface VideoUrlContentPart {
  type: 'video_url';
  video_url: { url: string };
}

export interface FileContentPart {
  type: 'file';
  file: { file_data: string; filename?: string };
}

export type ContentPart =
  | TextContentPart
  | ImageUrlContentPart
  | InputAudioContentPart
  | VideoUrlContentPart
  | FileContentPart;

export type MessageContent = string | ContentPart[];

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: MessageContent;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export function messageContentToText(content: MessageContent): string {
  if (typeof content === 'string') {
    return content;
  }

  return content
    .map((part) => {
      switch (part.type) {
        case 'text':
          return part.text;
        case 'image_url':
          return '[image]';
        case 'input_audio':
          return '[audio]';
        case 'video_url':
          return '[video]';
        case 'file':
          return part.file.filename ? `[file: ${part.file.filename}]` : '[file]';
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join(' ');
}

export function isTextMessageContent(content: MessageContent): content is string {
  return typeof content === 'string';
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface ChatCompletionOptions {
  model?: string;
  stream?: boolean;
  system?: string;
  format?: OutputFormat;
  character?: string;
  tools?: string[];
  continue?: boolean;
  conversationId?: string;
}

export interface ImageGenerationOptions {
  model?: string;
  output?: string;
  width?: number;
  height?: number;
  format?: OutputFormat;
}

export interface TTSOptions {
  voice?: string;
  model?: string;
  output?: string;
}

export interface TranscribeOptions {
  model?: string;
  format?: OutputFormat;
}

export interface SearchOptions {
  model?: string;
  results?: number;
  format?: OutputFormat;
}

export interface ConversationEntry {
  id: string;
  timestamp: string;
  messages: Message[];
  model: string;
  character?: string;
}

export interface UsageRecord {
  timestamp: string;
  command: string;
  model: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export interface ModelCapabilities {
  privacy?: boolean;
  supportsTeeAttestation?: boolean;
  supportsE2EE?: boolean;
  supportsResponseSchema?: boolean;
  supportsReasoning?: boolean;
  supportsReasoningEffort?: boolean;
  supportsXSearch?: boolean;
  supportsVision?: boolean;
  supportsMultipleImages?: boolean;
  maxImages?: number;
  supportsAudioInput?: boolean;
  supportsVideoInput?: boolean;
  maxVideos?: number;
}

export interface Model {
  id: string;
  type?: string;
  model_spec?: {
    description?: string;
    capabilities?: ModelCapabilities;
  };
}

export const isE2EEModel = (model: Model): boolean =>
  model.type === 'text' && model.model_spec?.capabilities?.supportsE2EE === true;

export const isTEEModel = (model: Model): boolean =>
  model.model_spec?.capabilities?.supportsTeeAttestation === true;

export const supportsResponseSchema = (model: Model): boolean =>
  model.model_spec?.capabilities?.supportsResponseSchema === true;

export const supportsReasoningEffort = (model: Model): boolean =>
  model.model_spec?.capabilities?.supportsReasoningEffort === true;

export const supportsXSearch = (model: Model): boolean =>
  model.model_spec?.capabilities?.supportsXSearch === true;

export const supportsVision = (model: Model): boolean =>
  model.model_spec?.capabilities?.supportsVision === true;

export const supportsMultipleImages = (model: Model): boolean =>
  model.model_spec?.capabilities?.supportsMultipleImages === true;

export const supportsAudioInput = (model: Model): boolean =>
  model.model_spec?.capabilities?.supportsAudioInput === true;

export const supportsVideoInput = (model: Model): boolean =>
  model.model_spec?.capabilities?.supportsVideoInput === true;

export interface Character {
  id: string;
  name: string;
  description?: string;
  system_prompt?: string;
}

export interface ApiResponse<T = unknown> {
  data?: T;
  error?: {
    message: string;
    code?: string;
  };
}
