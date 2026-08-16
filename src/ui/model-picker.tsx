/**
 * Interactive model picker for the TUI.
 */

import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { listModels } from '../lib/api.js';
import type { Model } from '../types/index.js';
import { modelCapabilitySummary, profileModel, type ModelProfile } from '../agent/model-profile.js';

export interface ModelPickerProps {
  currentModel?: string;
  onSelect: (modelId: string, profile: ModelProfile) => void;
  availableModels?: Model[];
  limit?: number;
  columns?: number;
}

export interface ModelItem {
  key: string;
  label: string;
  value: ModelProfile;
}

export function buildModelItems(models: Model[], currentModel?: string, maxLabelWidth = 120): ModelItem[] {
  return models.map((model) => {
    const isCurrent = model.id === currentModel;
    const profile = profileModel(model);
    const privacy = profile.privacy === 'private' ? '🔒' : '';
    const label = `${isCurrent ? '● ' : ''}${model.id} ${privacy}  ${modelCapabilitySummary(profile)}`.trim();
    return {
      key: model.id || String(model.id),
      label: label.length > maxLabelWidth ? `${label.slice(0, Math.max(1, maxLabelWidth - 1))}…` : label,
      value: profile,
    };
  });
}

export function ModelPicker({ currentModel, onSelect, availableModels, limit = 8, columns = 80 }: ModelPickerProps): JSX.Element {
  const [models, setModels] = useState<Model[]>(availableModels ?? []);
  const [loading, setLoading] = useState(availableModels === undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (availableModels) {
      setModels(availableModels);
      setLoading(false);
      return;
    }
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
  }, [availableModels]);

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

  const items = buildModelItems(models, currentModel, Math.max(20, columns - 8));

  return (
    <Box flexDirection="column" borderStyle="single" padding={1}>
      <Text bold>Select model</Text>
      <Text dimColor>{models.length} available</Text>
      <SelectInput items={items} limit={limit} onSelect={(item) => onSelect(item.value.id, item.value)} />
      <Text dimColor>↑↓ to navigate, Enter to select, Esc to cancel</Text>
    </Box>
  );
}
