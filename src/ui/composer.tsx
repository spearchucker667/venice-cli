import { useEffect, useRef, useState } from 'react';
import { readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { isPathInside } from '../agent/workspace.js';

export interface ComposerProps {
  onSubmit: (text: string) => void;
  workspaceRoot: string;
  disabled?: boolean;
  maxSuggestions?: number;
  columns?: number;
}

const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', 'target', 'vendor']);

export async function findMentionCompletions(workspaceRoot: string, query: string): Promise<string[]> {
  const normalized = query.replaceAll('\\', '/');
  if (normalized.startsWith('/') || path.win32.isAbsolute(query) || normalized.split('/').includes('..')) return [];
  const slash = normalized.lastIndexOf('/');
  const directoryPart = slash >= 0 ? normalized.slice(0, slash + 1) : '';
  const prefix = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const root = path.resolve(workspaceRoot);
  const directory = path.resolve(root, directoryPart || '.');
  if (!isPathInside(root, directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => !entry.name.startsWith('.') && (!entry.isDirectory() || !IGNORED_DIRECTORIES.has(entry.name)))
    .filter((entry) => entry.name.toLowerCase().startsWith(prefix.toLowerCase()))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .slice(0, 8)
    .map((entry) => `${directoryPart}${entry.name}${entry.isDirectory() ? '/' : ''}`);
}

export function Composer({ onSubmit, workspaceRoot, disabled, maxSuggestions = 8, columns = 80 }: ComposerProps): JSX.Element {
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draft, setDraft] = useState('');
  const [autocompleteOptions, setAutocompleteOptions] = useState<string[]>([]);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const valueRef = useRef(value);
  const lookupSequence = useRef(0);
  useEffect(() => { valueRef.current = value; }, [value]);

  useEffect(() => {
    const match = value.match(/@([^\s]*)$/);
    const sequence = ++lookupSequence.current;
    if (!match) {
      setAutocompleteOptions([]);
      return;
    }
    const timer = setTimeout(() => {
      findMentionCompletions(workspaceRoot, match[1])
        .then((options) => {
          if (lookupSequence.current === sequence) {
            setAutocompleteOptions(options.slice(0, maxSuggestions));
            setAutocompleteIndex(0);
          }
        })
        .catch(() => {
          if (lookupSequence.current === sequence) setAutocompleteOptions([]);
        });
    }, 75);
    return () => clearTimeout(timer);
  }, [value, workspaceRoot, maxSuggestions]);

  const updateValue = (next: string) => {
    setValue(next);
    if (historyIndex === -1) setDraft(next);
  };

  useInput((input, key) => {
    if (disabled) return;
    if (autocompleteOptions.length > 0) {
      if (key.upArrow || key.downArrow) {
        setAutocompleteIndex((previous) => key.upArrow
          ? (previous > 0 ? previous - 1 : autocompleteOptions.length - 1)
          : (previous < autocompleteOptions.length - 1 ? previous + 1 : 0));
        return;
      }
      if (key.tab) {
        const selected = autocompleteOptions[autocompleteIndex];
        updateValue(valueRef.current.replace(/@([^\s]*)$/, `@${selected}`));
        setAutocompleteOptions([]);
        return;
      }
    }
    if (key.ctrl && input === 'j') {
      updateValue(`${valueRef.current}\n`);
      return;
    }
    if (key.return) {
      const submitted = valueRef.current.trim();
      if (!submitted) return;
      onSubmit(submitted);
      setHistory((previous) => [submitted, ...previous.filter((item) => item !== submitted)]);
      setHistoryIndex(-1);
      setDraft('');
      setValue('');
      setAutocompleteOptions([]);
      return;
    }
    if (key.upArrow && history.length > 0 && historyIndex < history.length - 1) {
      if (historyIndex === -1) setDraft(valueRef.current);
      const next = historyIndex + 1;
      setHistoryIndex(next);
      setValue(history[next]);
      return;
    }
    if (key.downArrow && historyIndex >= 0) {
      const next = historyIndex - 1;
      setHistoryIndex(next);
      setValue(next === -1 ? draft : history[next]);
    }
  });

  const lines = value.split('\n');
  const currentLine = lines.at(-1) ?? '';
  return (
    <Box flexDirection="column">
      {autocompleteOptions.length > 0 && (
        <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
          <Text bold color="cyan">Files</Text>
          {autocompleteOptions.map((option, index) => (
            <Text key={option} color={index === autocompleteIndex ? 'green' : undefined}>
              {truncateSuggestion(`${index === autocompleteIndex ? '> ' : '  '}@${option}`, columns)}
            </Text>
          ))}
        </Box>
      )}
      {lines.slice(0, -1).map((line, index) => <Text key={`${index}:${line}`}>{index === 0 ? '> ' : '  '}{line}</Text>)}
      <Box>
        <Text bold>{lines.length === 1 ? '> ' : '  '}</Text>
        <TextInput value={currentLine} onChange={(line) => updateValue([...lines.slice(0, -1), line].join('\n'))} />
      </Box>
    </Box>
  );
}

function truncateSuggestion(value: string, columns: number): string {
  const width = Math.max(20, columns - 4);
  return value.length > width ? `${value.slice(0, width - 1)}…` : value;
}
