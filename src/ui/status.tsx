/**
 * Status bar for the TUI.
 */

import { Box, Text } from 'ink';
import type { TuiState } from './types.js';
import { formatTokenLimit } from '../agent/model-profile.js';
import { STATUS_MARK, resolveGreetingPolicy } from './brand.js';

export interface StatusBarProps {
  state: TuiState;
  columns?: number;
}

export function StatusBar({ state, columns = 80 }: StatusBarProps): JSX.Element {
  // Same cached policy as the greeting: accent only on truecolor TTYs, so the
  // mark stays plain-text where the greeting's mark is plain too.
  const accentColor = resolveGreetingPolicy().accentColor;
  const isUnknown = state.maxTokens === 0;
  const contextPct = !isUnknown ? Math.round((state.contextTokens / state.maxTokens) * 100) : 0;
  const additionalRoots = state.additionalRoots?.filter((r) => r !== state.workspaceRoot) ?? [];
  const location = state.gitBranch || shortenPath(state.workspaceRoot);
  const agentMode = state.agentMode === 'chat-only' ? 'chat-only' : 'agent';
  const modeParts = [agentMode];
  if (state.operatingMode === 'plan') modeParts.push('plan');
  if (state.inputMode === 'shell') modeParts.push('shell');
  if (additionalRoots.length > 0) modeParts.push(`+${additionalRoots.length}dir`);
  if (state.queuedCount && state.queuedCount > 0) modeParts.push(`queue:${state.queuedCount}`);
  const mode = modeParts.join('+');
  const context = isUnknown ? 'context unknown' : `${contextPct}% of ${formatTokenLimit(state.maxTokens).replace(' ctx', '')}`;
  const narrow = columns <= 72;
  // Same minimal boundary as the greeting: drop the brand mark when the
  // terminal is too small for it to be worth the columns.
  const showMark = columns > 40;
  const modelLimit = columns <= 55 ? 10 : 18;
  const model = narrow && state.model.length > modelLimit ? `${state.model.slice(0, modelLimit - 1)}…` : state.model;
  const content = narrow
    ? `${model} · ${mode} · ${state.approvalMode} · ${state.status} · ${isUnknown ? '?' : `${contextPct}%`}`
    : `${model} · ${mode} · ${location} · ${state.approvalMode} · ${state.status} · ${context}`;
  return (
    <Box borderStyle="single" paddingX={1}>
      {showMark && (
        <Text color={accentColor}>{STATUS_MARK} </Text>
      )}
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
