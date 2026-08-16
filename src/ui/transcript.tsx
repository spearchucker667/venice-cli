/**
 * Scrollable transcript of messages and events for the TUI.
 */

import { Box, Text } from 'ink';
import type { TuiMessage } from './types.js';
import { ToolCallEvent } from './tool-call.js';

export interface TranscriptProps {
  messages: TuiMessage[];
}

export function Transcript({ messages }: TranscriptProps): JSX.Element {
  return (
    <Box flexDirection="column" flexGrow={1}>
      {messages.map((message) => {
        switch (message.role) {
          case 'user':
            return (
              <Box key={message.id}>
                <Text bold>{'> '}</Text>
                <Text>{message.content}</Text>
              </Box>
            );
          case 'assistant':
            return (
              <Box key={message.id} flexDirection="column">
                <Text>{message.content}</Text>
              </Box>
            );
          case 'tool':
            return (
              <ToolCallEvent
                key={message.id}
                toolName={String(message.metadata?.toolName || 'tool')}
                input={message.metadata?.input}
                ok={message.metadata?.ok as boolean | undefined}
                error={message.metadata?.error as string | undefined}
              />
            );
          case 'event':
          case 'system':
            return (
              <Box key={message.id}>
                <Text dimColor>{message.content}</Text>
              </Box>
            );
          default:
            return null;
        }
      })}
    </Box>
  );
}
