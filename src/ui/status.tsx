/**
 * Status bar for the TUI.
 */

import { Box, Text } from 'ink';
import type { TuiState } from './types.js';
import { formatTokenLimit } from '../agent/model-profile.js';

export interface StatusBarProps {
  state: TuiState;
  columns?: number;
}

export function StatusBar({ state, columns = 80 }: StatusBarProps): JSX.Element {
  const isUnknown = state.maxTokens === 0;
  const contextPct = !isUnknown ? Math.round((state.contextTokens / state.maxTokens) * 100) : 0;
  const location = state.gitBranch || shortenPath(state.workspaceRoot);
  const agentMode = state.agentMode === 'chat-only' ? 'chat-only' : 'agent';
  const modeParts = [agentMode];
  if (state.operatingMode === 'plan') modeParts.push('plan');
  if (state.inputMode === 'shell') modeParts.push('shell');
  const mode = modeParts.join('+');
  const context = isUnknown ? 'context unknown' : `${contextPct}% of ${formatTokenLimit(state.maxTokens).replace(' ctx', '')}`;
  const narrow = columns <= 72;
  const modelLimit = columns <= 55 ? 10 : 18;
  const model = narrow && state.model.length > modelLimit ? `${state.model.slice(0, modelLimit - 1)}…` : state.model;
  const content = narrow
    ? `${model} · ${mode} · ${state.approvalMode} · ${state.status} · ${isUnknown ? '?' : `${contextPct}%`}`
    : `${model} · ${mode} · ${location} · ${state.approvalMode} · ${state.status} · ${context}`;
  return (
    <Box borderStyle="single" paddingX={1}>
      <Text wrap="truncate-end">{content}</Text>
    </Box>
  );
}

function shortenPath(value: string): string {
  const home = process.env.HOME;
  if (home && (value === home || value.startsWith(home + '/'))) return `~${value.slice(home.length)}`;
  const parts = value.split(/[\\/]/).filter(Boolean);
  if (value.length > 24 && parts.length) {
    const leaf = parts.at(-1) || value;
    return `…/${leaf.length > 18 ? `${leaf.slice(0, 17)}…` : leaf}`;
  }
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : value;
}
