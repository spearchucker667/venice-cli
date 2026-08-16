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
  const formatInput = (data: unknown) => {
    try {
      const str = JSON.stringify(data);
      if (str.length > 80) {
        return str.substring(0, 77) + '...';
      }
      return str;
    } catch {
      return '[object Object]';
    }
  };

  const formatError = (err?: string) => {
    if (!err) return 'failed';
    return err.split('\n')[0];
  };

  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text dimColor>• {toolName}</Text>
      <Text dimColor>{formatInput(input)}</Text>
      {ok === true && <Text color="green">✓ done</Text>}
      {ok === false && <Text color="red">✗ {formatError(error)}</Text>}
    </Box>
  );
}
