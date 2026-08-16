/**
 * Interactive model picker for the TUI.
 */

import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { listModels } from '../lib/api.js';
import type { Model } from '../types/index.js';

export interface ModelPickerProps {
  currentModel?: string;
  onSelect: (modelId: string) => void;
}

interface ModelItem {
  key: string;
  label: string;
  value: string;
}

export function ModelPicker({ currentModel, onSelect }: ModelPickerProps): JSX.Element {
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    listModels({ showSpinner: false })
      .then((fetched) => {
        if (cancelled) return;
        const textModels = fetched.filter((m) => (m.type || 'text').toLowerCase() === 'text');
        setModels(textModels.length ? textModels : fetched);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <Box paddingX={1}>
        <Text dimColor>Loading models…</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="red">Failed to load models: {error}</Text>
        <Text dimColor>Press Esc or Ctrl+C to close.</Text>
      </Box>
    );
  }

  if (!models.length) {
    return (
      <Box paddingX={1}>
        <Text dimColor>No models available.</Text>
      </Box>
    );
  }

  const items: ModelItem[] = models.map((model) => {
    const isCurrent = model.id === currentModel;
    const privacy = (model.model_spec as { privacy?: string } | undefined)?.privacy === 'private' ? '🔒' : '';
    return {
      key: model.id || String(model.id),
      label: `${isCurrent ? '● ' : ''}${model.id} ${privacy}`.trim(),
      value: model.id || '',
    };
  });

  return (
    <Box flexDirection="column" borderStyle="single" padding={1}>
      <Text bold>Select model</Text>
      <Text dimColor>{models.length} available</Text>
      <SelectInput items={items} onSelect={(item) => onSelect(item.value)} />
      <Text dimColor>↑↓ to navigate, Enter to select, Esc to cancel</Text>
    </Box>
  );
}
