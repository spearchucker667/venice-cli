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
  // Coalesce assistant deltas by ID before slicing so long streamed messages
  // are not truncated at the beginning (VCLI-LIVE-003).
  const coalesced = messages.reduce<TuiMessage[]>((acc, message) => {
    if (message.role === 'assistant') {
      const existing = acc.find((m) => m.id === message.id && m.role === 'assistant');
      if (existing) {
        // Only append delta content; assistant_complete will just overwrite with full content
        // Or actually, if we receive assistant_complete, we want it to replace the content
        // Let's just append for now, or just use the complete content if it's longer.
        // Wait, if assistant_complete is the final event, it has the FULL content.
        // If we append it, we'll double the content!
        // We should just use the new content if it's replacing it, but how do we know if it's a delta vs complete?
        // Let's look at events.ts changes next...
        // If we just overwrite content, we lose earlier deltas if it's a delta.
        // Let's add metadata: { isDelta: true } in events.ts to distinguish!
        if (message.metadata?.isDelta) {
          existing.content += message.content;
        } else {
          existing.content = message.content; // It's the complete message
        }
        return acc;
      }
    }
    acc.push({ ...message });
    return acc;
  }, []);

  const visible = maxMessages && coalesced.length > maxMessages ? coalesced.slice(-maxMessages) : coalesced;
  const hidden = coalesced.length - visible.length;
  return (
    <Box flexDirection="column" flexGrow={1}>
      {hidden > 0 && <Text dimColor>… {hidden} earlier entries hidden</Text>}
      {visible.map((message) => {
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
