/**
 * Persistent composer input for the TUI.
 */

import { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

export interface ComposerProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
}

export function Composer({ onSubmit, disabled }: ComposerProps): JSX.Element {
  const [value, setValue] = useState('');

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setValue('');
  };

  return (
    <Box>
      <Text bold>{'> '}</Text>
      <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} />
    </Box>
  );
}
