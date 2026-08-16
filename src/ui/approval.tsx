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

  const formatInput = (data: unknown) => {
    try {
      const str = JSON.stringify(data, null, 2);
      const lines = str.split('\n');
      if (lines.length > 10) {
        return lines.slice(0, 10).join('\n') + '\n  ...';
      }
      return str;
    } catch {
      return '[object Object]';
    }
  };

  return (
    <Box flexDirection="column" borderStyle="single" padding={1} borderColor={risk === 'execute' ? 'red' : 'yellow'}>
      <Text bold>Allow {toolName}?</Text>
      <Text dimColor>Risk: {risk}</Text>
      <Text>{formatInput(input)}</Text>
      <Box marginTop={1}>
        <SelectInput items={items} onSelect={(item) => onDecision(item.value)} />
      </Box>
    </Box>
  );
}
