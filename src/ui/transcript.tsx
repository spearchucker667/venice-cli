/**
 * Scrollable transcript of messages and events for the TUI.
 */

import { Box, Text } from 'ink';
import type { TuiMessage } from './types.js';
import { ToolCallEvent } from './tool-call.js';

export interface TranscriptProps {
  messages: TuiMessage[];
  maxMessages?: number;
}

export function Transcript({ messages, maxMessages }: TranscriptProps): JSX.Element {
  const visible = maxMessages && messages.length > maxMessages ? messages.slice(-maxMessages) : messages;
  const hidden = messages.length - visible.length;
  // Streaming emits one assistant_delta per chunk; merge consecutive assistant
  // messages so incremental content renders as a single bubble (VCL-R3-012).
  const merged = visible.reduce<TuiMessage[]>((acc, message) => {
    const previous = acc[acc.length - 1];
    if (message.role === 'assistant' && previous?.role === 'assistant') {
      acc[acc.length - 1] = { ...previous, content: previous.content + message.content };
      return acc;
    }
    acc.push(message);
    return acc;
  }, []);
  return (
    <Box flexDirection="column" flexGrow={1}>
      {hidden > 0 && <Text dimColor>… {hidden} earlier entries hidden</Text>}
      {merged.map((message) => {
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
                result={message.metadata?.result}
                pending={message.metadata?.pending as boolean | undefined}
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
