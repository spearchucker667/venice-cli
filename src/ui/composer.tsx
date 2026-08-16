import { useState, useRef, useEffect } from 'react';
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

  const [autocompleteOptions, setAutocompleteOptions] = useState<string[]>([]);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);

  // Keep ref in sync to avoid stale closure in useInput
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const valueRef = useRef(value);

  const fetchAutocomplete = (text: string) => {
    const match = text.match(/@([a-zA-Z0-9_.-]*)$/);
    if (!match) {
      setAutocompleteOptions([]);
      return;
    }
    const query = match[1];
    try {
      const fs = require('node:fs');
      const files = fs.readdirSync(process.cwd()).filter((f: string) => !f.startsWith('.git') && !f.startsWith('node_modules'));
      const options = files.filter((f: string) => f.toLowerCase().includes(query.toLowerCase())).slice(0, 5);
      setAutocompleteOptions(options);
      setAutocompleteIndex(0);
    } catch {
      setAutocompleteOptions([]);
    }
  };

  const handleValueChange = (newValue: string) => {
    setValue(newValue);
    fetchAutocomplete(newValue);
  };

  useInput((_input, key) => {
    if (disabled) return;

    if (autocompleteOptions.length > 0) {
      if (key.upArrow) {
        setAutocompleteIndex((prev) => (prev > 0 ? prev - 1 : autocompleteOptions.length - 1));
        return;
      }
      if (key.downArrow) {
        setAutocompleteIndex((prev) => (prev < autocompleteOptions.length - 1 ? prev + 1 : 0));
        return;
      }
      if (key.return || key.tab) {
        const selected = autocompleteOptions[autocompleteIndex];
        const newValue = valueRef.current.replace(/@([a-zA-Z0-9_.-]*)$/, `@${selected} `);
        setValue(newValue);
        setAutocompleteOptions([]);
        return;
      }
    }

    if (key.return) {
      const trimmed = valueRef.current.trim();
      if (!trimmed) return;
      onSubmit(trimmed);
      setHistory((prev) => [trimmed, ...prev]);
      setHistoryIndex(-1);
      setValue('');
      setAutocompleteOptions([]);
      return;
    }

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

  return (
    <Box flexDirection="column">
      {autocompleteOptions.length > 0 && (
        <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
          <Text bold color="cyan">Files</Text>
          {autocompleteOptions.map((opt, i) => (
            <Text key={opt} color={i === autocompleteIndex ? 'green' : undefined}>
              {i === autocompleteIndex ? '> ' : '  '}@{opt}
            </Text>
          ))}
        </Box>
      )}
      <Box>
        <Text bold>{'> '}</Text>
        <TextInput value={value} onChange={handleValueChange} />
      </Box>
    </Box>
  );
}
