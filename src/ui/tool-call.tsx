/**
 * Render a tool-call event in the TUI transcript.
 */

import { Box, Text } from 'ink';
import { compactError, toolActivity, toolResultSummary } from './tool-format.js';

export interface ToolCallEventProps {
  toolName: string;
  input: unknown;
  ok?: boolean;
  error?: string;
  result?: unknown;
  pending?: boolean;
}

export function ToolCallEvent({ toolName, input, ok, error, result, pending }: ToolCallEventProps): JSX.Element {
  const resultLike = (result && typeof result === 'object')
    ? result as { ok?: boolean; data?: unknown; error?: { message?: string } }
    : { ok, error: error ? { message: error } : undefined };
  const shellData = toolName === 'shell' && resultLike.data && typeof resultLike.data === 'object'
    ? resultLike.data as { exitCode?: number | null; stdout?: string; stderr?: string }
    : undefined;
  const failed = ok === false || (typeof shellData?.exitCode === 'number' && shellData.exitCode !== 0);
  const failureOutput = error || (failed ? shellData?.stderr || shellData?.stdout : undefined);
  const failureLines = shellData ? compactError(failureOutput).slice(0, 2) : compactError(failureOutput).slice(1);
  const summary = toolResultSummary(toolName, resultLike);
  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text wrap="truncate-end" color={failed ? 'red' : ok === true ? 'green' : undefined}>
        {failed ? '✗' : ok === true ? '✓' : '●'} {toolActivity(toolName, input)}{pending ? '' : ` · ${summary}`}
      </Text>
      {failed && failureLines.map((line) => (
        <Text key={line} color="red" dimColor wrap="truncate-end">  {line}</Text>
      ))}
    </Box>
  );
}
