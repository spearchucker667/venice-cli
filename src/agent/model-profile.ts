import type { Model } from '../types/index.js';

export type AgentMode = 'agent' | 'chat-only';

export interface ModelProfile {
  id: string;
  mode: AgentMode;
  contextLimit?: number;
  privacy?: string;
  supportsFunctionCalling?: boolean;
  supportsReasoning?: boolean;
  supportsVision?: boolean;
  supportsE2EE?: boolean;
  supportsTeeAttestation?: boolean;
}

export function profileModel(model: Model): ModelProfile {
  const capabilities = model.model_spec?.capabilities;
  const supportsFunctionCalling = capabilities?.supportsFunctionCalling;
  return {
    id: model.id,
    mode: supportsFunctionCalling === false ? 'chat-only' : 'agent',
    contextLimit: model.model_spec?.availableContextTokens,
    privacy: model.model_spec?.privacy,
    supportsFunctionCalling,
    supportsReasoning: capabilities?.supportsReasoning,
    supportsVision: capabilities?.supportsVision,
    supportsE2EE: capabilities?.supportsE2EE,
    supportsTeeAttestation: capabilities?.supportsTeeAttestation,
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
