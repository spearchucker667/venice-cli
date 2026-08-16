import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

export interface ComposerProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
}

export function Composer({ onSubmit, disabled }: ComposerProps): JSX.Element {
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  useInput((_input, key) => {
    if (disabled) return;

    if (key.upArrow) {
      if (history.length > 0 && historyIndex < history.length - 1) {
        const nextIndex = historyIndex + 1;
        setHistoryIndex(nextIndex);
        setValue(history[nextIndex]);
      }
      return;
    }

    if (key.downArrow) {
      if (historyIndex > 0) {
        const prevIndex = historyIndex - 1;
        setHistoryIndex(prevIndex);
        setValue(history[prevIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setValue('');
      }
      return;
    }
  });

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
    setHistory((prev) => [trimmed, ...prev]);
    setHistoryIndex(-1);
    setValue('');
  };

  return (
    <Box>
      <Text bold>{'> '}</Text>
      <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} />
    </Box>
  );
}
