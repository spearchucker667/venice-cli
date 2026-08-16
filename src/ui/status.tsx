/**
 * Status bar for the TUI.
 */

import { Box, Text } from 'ink';
import type { TuiState } from './types.js';

export interface StatusBarProps {
  state: TuiState;
}

export function StatusBar({ state }: StatusBarProps): JSX.Element {
  const contextPct = state.maxTokens > 0 ? Math.round((state.contextTokens / state.maxTokens) * 100) : 0;
  return (
    <Box justifyContent="space-between" borderStyle="single" paddingX={1}>
      <Text>{state.model} · {state.workspaceRoot}</Text>
      <Text>{state.status} · {state.approvalMode} · {state.contextTokens}/{state.maxTokens} ({contextPct}%)</Text>
    </Box>
  );
}
