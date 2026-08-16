/**
 * Inline approval prompt for the TUI.
 */

import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';

export interface ApprovalDecision {
  approved: boolean;
  scope?: 'once' | 'session' | 'pattern';
}

export interface ApprovalPromptProps {
  toolName: string;
  input: unknown;
  risk: string;
  onDecision: (decision: ApprovalDecision) => void;
}

export function ApprovalPrompt({ toolName, input, risk, onDecision }: ApprovalPromptProps): JSX.Element {
  const items: Array<{ key: string; label: string; value: ApprovalDecision }> = [
    { key: 'yes', label: 'Yes', value: { approved: true, scope: 'once' } },
    { key: 'session', label: 'Allow this session', value: { approved: true, scope: 'session' } },
    { key: 'no', label: 'No', value: { approved: false } },
  ];

  return (
    <Box flexDirection="column" borderStyle="single" padding={1}>
      <Text bold>Allow {toolName}?</Text>
      <Text dimColor>Risk: {risk}</Text>
      <Text>{JSON.stringify(input)}</Text>
      <SelectInput items={items} onSelect={(item) => onDecision(item.value)} />
    </Box>
  );
}
