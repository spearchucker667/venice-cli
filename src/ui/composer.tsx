import { useEffect, useMemo, useRef, useState } from 'react';
import { readdir } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import * as os from 'node:os';
import * as path from 'node:path';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { isPathInside } from '../agent/workspace.js';
import { findSlashCommands } from './slash-commands.js';

export interface ComposerProps {
  onSubmit: (text: string) => void;
  /** Inject the current draft into the running turn (Ctrl-S). Returns true when consumed. */
  onInject?: (text: string) => boolean;
  workspaceRoot: string;
  inputMode?: 'agent' | 'shell';
  operatingMode?: 'agent' | 'plan';
  disabled?: boolean;
  maxSuggestions?: number;
  columns?: number;
}

const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', 'target', 'vendor']);
const EMPTY_SLASH_OPTIONS: Array<{ name: string; description: string }> = [];
const MAX_HISTORY = 100;
const MAX_MENTION_RESULTS = 8;

function getComposerHistoryFile(): string {
  return path.join(os.homedir(), '.venice', 'composer-history.json');
}

export function loadComposerHistory(): string[] {
  try {
    const file = getComposerHistoryFile();
    if (!existsSync(file)) return [];
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf-8'));
    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is string => typeof entry === 'string').slice(-MAX_HISTORY);
    }
  } catch {
    // Corrupt/unreadable history is not fatal (VC-KIMI-052).
  }
  return [];
}

export function persistComposerHistory(history: string[]): void {
  try {
    const file = getComposerHistoryFile();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(history.slice(-MAX_HISTORY), null, 2), { mode: 0o600 });
  } catch {
    // Best effort: a read-only home directory must not break the composer.
  }
}

function listGitFiles(root: string): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard'],
      { cwd: root, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }
        resolve(stdout.split('\n').map((line) => line.trim()).filter(Boolean));
      }
    );
  });
}

function hasIgnoredSegment(relativePath: string): boolean {
  return relativePath
    .split('/')
    .some((segment) => segment.startsWith('.') || IGNORED_DIRECTORIES.has(segment));
}

/**
 * Git-aware file-mention completion (VC-KIMI-050).
 *
 * Combines `git ls-files` (deep, repo-wide tracked/untracked-but-not-ignored
 * paths) with a filesystem directory listing (directories and any files git
 * doesn't know about). Matching is substring-based across the whole path, not
 * just a prefix of the final component, and results prefer directories and
 * prefix matches.
 */
export async function findMentionCompletions(workspaceRoot: string, query: string): Promise<string[]> {
  const normalized = query.replaceAll('\\', '/');
  if (normalized.startsWith('/') || path.win32.isAbsolute(query) || normalized.split('/').includes('..')) return [];
  const root = path.resolve(workspaceRoot);
  const q = normalized.toLowerCase();

  const candidates: Array<{ value: string; isDir: boolean }> = [];

  const gitFiles = await listGitFiles(root);
  for (const file of gitFiles) {
    if (hasIgnoredSegment(file)) continue;
    candidates.push({ value: file, isDir: false });
  }

  const slash = normalized.lastIndexOf('/');
  const directoryPart = slash >= 0 ? normalized.slice(0, slash + 1) : '';
  const directory = path.resolve(root, directoryPart || '.');
  if (isPathInside(root, directory)) {
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name))) continue;
        candidates.push({ value: `${directoryPart}${entry.name}`, isDir: entry.isDirectory() });
      }
    } catch {
      // Unreadable directory yields no filesystem candidates.
    }
  }

  const seen = new Set<string>();
  const results: string[] = [];
  candidates
    .filter((candidate) => candidate.value.toLowerCase().includes(q))
    .sort((a, b) => {
      const aDir = a.isDir ? 0 : 1;
      const bDir = b.isDir ? 0 : 1;
      if (aDir !== bDir) return aDir - bDir;
      const aPrefix = a.value.toLowerCase().startsWith(q) ? 0 : 1;
      const bPrefix = b.value.toLowerCase().startsWith(q) ? 0 : 1;
      if (aPrefix !== bPrefix) return aPrefix - bPrefix;
      return a.value.localeCompare(b.value);
    })
    .forEach((candidate) => {
      if (seen.has(candidate.value) || results.length >= MAX_MENTION_RESULTS) return;
      seen.add(candidate.value);
      results.push(`${candidate.value}${candidate.isDir ? '/' : ''}`);
    });
  return results;
}

export function Composer({ onSubmit, onInject, workspaceRoot, inputMode = 'agent', operatingMode = 'agent', disabled, maxSuggestions = 8, columns = 80 }: ComposerProps): JSX.Element {
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>(() => loadComposerHistory());
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draft, setDraft] = useState('');
  const [autocompleteOptions, setAutocompleteOptions] = useState<string[]>([]);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const [slashIndex, setSlashIndex] = useState(0);
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

  const slashOptions = useMemo(() => {
    const match = value.match(/^\/([^\s]*)$/);
    if (!match) return EMPTY_SLASH_OPTIONS;
    return findSlashCommands(value)
      .slice(0, maxSuggestions)
      .map((cmd) => ({ name: cmd.name, description: cmd.description }));
  }, [value, maxSuggestions]);

  useEffect(() => {
    if (value.match(/^\/([^\s]*)$/)) {
      setSlashIndex(0);
    }
  }, [value]);

  const updateValue = (next: string) => {
    setValue(next);
    if (historyIndex === -1) setDraft(next);
  };

  useInput((input, key) => {
    if (disabled) return;
    const plainEnter = key.return && !key.shift && !key.meta;
    if (slashOptions.length > 0) {
      if (key.upArrow || key.downArrow) {
        setSlashIndex((previous) => key.upArrow
          ? (previous > 0 ? previous - 1 : slashOptions.length - 1)
          : (previous < slashOptions.length - 1 ? previous + 1 : 0));
        return;
      }
      if (key.tab || plainEnter) {
        const selected = slashOptions[slashIndex];
        updateValue(`/${selected.name} `);
        return;
      }
    }
    if (autocompleteOptions.length > 0) {
      if (key.upArrow || key.downArrow) {
        setAutocompleteIndex((previous) => key.upArrow
          ? (previous > 0 ? previous - 1 : autocompleteOptions.length - 1)
          : (previous < autocompleteOptions.length - 1 ? previous + 1 : 0));
        return;
      }
      if (key.tab || plainEnter) {
        // Enter accepts the highlighted completion like current Kimi
        // (VC-KIMI-051); Tab also still works.
        const selected = autocompleteOptions[autocompleteIndex];
        updateValue(valueRef.current.replace(/@([^\s]*)$/, `@${selected}`));
        setAutocompleteOptions([]);
        return;
      }
    }
    if ((key.ctrl && input === 'j') || (key.return && (key.shift || key.meta))) {
      updateValue(`${valueRef.current}\n`);
      return;
    }
    if (key.ctrl && input === 's') {
      // Inject the draft into the current turn (VC-KIMI-053).
      if (onInject?.(valueRef.current)) {
        updateValue('');
        setAutocompleteOptions([]);
      }
      return;
    }
    if (key.return) {
      const submitted = valueRef.current.trim();
      if (!submitted) return;
      onSubmit(submitted);
      const nextHistory = [submitted, ...history.filter((item) => item !== submitted)].slice(0, MAX_HISTORY);
      setHistory(nextHistory);
      persistComposerHistory(nextHistory);
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
  const promptChar = operatingMode === 'plan' ? 'P' : inputMode === 'shell' ? '$' : '>';
  return (
    <Box flexDirection="column">
      {slashOptions.length > 0 && (
        <Box flexDirection="column" borderStyle="round" paddingX={1} marginBottom={1}>
          <Text bold color="cyan">Commands</Text>
          {slashOptions.map((option, index) => (
            <Text key={option.name} color={index === slashIndex ? 'green' : undefined}>
              {truncateSuggestion(`${index === slashIndex ? '> ' : '  '}/${option.name} — ${option.description}`, columns)}
            </Text>
          ))}
        </Box>
      )}
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
      {lines.slice(0, -1).map((line, index) => <Text key={`${index}:${line}`}>{index === 0 ? `${promptChar} ` : '  '}{line}</Text>)}
      <Box>
        <Text bold>{lines.length === 1 ? `${promptChar} ` : '  '}</Text>
        <TextInput value={currentLine} onChange={(line) => updateValue([...lines.slice(0, -1), line].join('\n'))} />
      </Box>
    </Box>
  );
}

function truncateSuggestion(value: string, columns: number): string {
  const width = Math.max(20, columns - 4);
  return value.length > width ? `${value.slice(0, width - 1)}…` : value;
}
