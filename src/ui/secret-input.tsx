/**
 * Hidden (masked) secret input prompt for the TUI.
 *
 * Rendered when a slash command needs a credential without a value (e.g.
 * `/config api-key`): the typed key is masked in place of `*` characters and
 * is never echoed to the transcript — only the handler's masked confirmation
 * is shown. Escape cancels; Enter confirms a non-empty value.
 */

import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

export interface SecretInputPromptProps {
  title: string;
  prompt: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function SecretInputPrompt({ title, prompt, onConfirm, onCancel }: SecretInputPromptProps): JSX.Element {
  const [value, setValue] = useState('');

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="single" padding={1} borderColor="cyan">
      <Text bold>{title}</Text>
      <Text dimColor>{prompt}</Text>
      <Box marginTop={1}>
        <TextInput
          value={value}
          onChange={setValue}
          mask="*"
          onSubmit={(answer) => {
            const trimmed = answer.trim();
            if (trimmed) onConfirm(trimmed);
          }}
        />
      </Box>
      <Text dimColor>Enter to confirm · Esc to cancel</Text>
    </Box>
  );
}