/**
 * Render a tool-call event in the TUI transcript.
 */

import { Box, Text } from 'ink';

export interface ToolCallEventProps {
  toolName: string;
  input: unknown;
  ok?: boolean;
  error?: string;
}

export function ToolCallEvent({ toolName, input, ok, error }: ToolCallEventProps): JSX.Element {
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text dimColor>• {toolName}</Text>
      <Text dimColor>{JSON.stringify(input)}</Text>
      {ok === true && <Text color="green">✓ done</Text>}
      {ok === false && <Text color="red">✗ {error || 'failed'}</Text>}
    </Box>
  );
}
