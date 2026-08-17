import type { Model } from '../types/index.js';

export type AgentMode = 'agent' | 'chat-only';

export interface ModelProfile {
  id: string;
  mode: AgentMode;
  contextLimit?: number;
  privacy?: string;
  supportsFunctionCalling?: boolean;
  supportsReasoning?: boolean;
  supportsReasoningEffort?: boolean;
  supportsVision?: boolean;
  supportsE2EE?: boolean;
  supportsTeeAttestation?: boolean;
  optimizedForCode?: boolean;
  supportsLogProbs?: boolean;
  supportsMultipleImages?: boolean;
  supportsResponseSchema?: boolean;
  supportsVideoInput?: boolean;
  supportsWebSearch?: boolean;
  supportsXSearch?: boolean;
  traits?: (string | { name: string; description?: string })[];
}

export function profileModel(model: Model): ModelProfile {
  const capabilities = model.model_spec?.capabilities;
  const supportsFunctionCalling = capabilities?.supportsFunctionCalling;
  return {
    id: model.id,
    // Fail closed: tools are granted only on positive capability evidence.
    // A model that omits the flag, or an unknown model, is chat-only until
    // its tool support is confirmed (VCL-R3-006).
    mode: supportsFunctionCalling === true ? 'agent' : 'chat-only',
    contextLimit: model.model_spec?.availableContextTokens,
    privacy: model.model_spec?.privacy,
    supportsFunctionCalling,
    supportsReasoning: capabilities?.supportsReasoning,
    supportsReasoningEffort: capabilities?.supportsReasoningEffort,
    supportsVision: capabilities?.supportsVision,
    supportsE2EE: capabilities?.supportsE2EE,
    supportsTeeAttestation: capabilities?.supportsTeeAttestation,
    optimizedForCode: capabilities?.optimizedForCode,
    supportsLogProbs: capabilities?.supportsLogProbs,
    supportsMultipleImages: capabilities?.supportsMultipleImages,
    supportsResponseSchema: capabilities?.supportsResponseSchema,
    supportsVideoInput: capabilities?.supportsVideoInput,
    supportsWebSearch: capabilities?.supportsWebSearch,
    supportsXSearch: capabilities?.supportsXSearch,
    traits: model.model_spec?.traits,
  };
}

export function modelCapabilitySummary(profile: ModelProfile): string {
  const fields = [
    profile.mode === 'chat-only' ? 'chat only' : 'tools',
    profile.supportsReasoning ? 'reasoning' : undefined,
    profile.supportsVision ? 'vision' : undefined,
    profile.supportsE2EE ? 'E2EE' : undefined,
    profile.supportsTeeAttestation ? 'TEE' : undefined,
    profile.privacy,
    profile.contextLimit ? formatTokenLimit(profile.contextLimit) : undefined,
  ];
  return fields.filter(Boolean).join(' · ');
}

export function formatTokenLimit(tokens: number): string {
  if (tokens >= 1_000_000 && tokens % 1_000_000 === 0) return `${tokens / 1_000_000}M ctx`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K ctx`;
  return `${tokens} ctx`;
}
