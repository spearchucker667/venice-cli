/**
 * Interactive session picker for the TUI.
 */

import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { SessionManager } from '../agent/sessions.js';

export interface SessionPickerProps {
  onSelect: (sessionId: string) => void;
  manager?: SessionManager;
  workspaceRoot?: string;
}

interface SessionItem {
  key: string;
  label: string;
  value: string;
}

export function SessionPicker({ onSelect, manager, workspaceRoot }: SessionPickerProps): JSX.Element {
  const resolved = manager || new SessionManager();
  const sessions = resolved.list(workspaceRoot);

  if (!sessions.length) {
    return (
      <Box paddingX={1}>
        <Text dimColor>No saved sessions.</Text>
      </Box>
    );
  }

  const items: SessionItem[] = sessions.map((session) => {
    const date = new Date(session.updatedAt).toLocaleString();
    const objective = session.state.objective || 'No objective';
    const preview = objective.length > 40 ? objective.slice(0, 37) + '…' : objective;
    return {
      key: session.sessionId,
      label: `${date} — ${preview}`,
      value: session.sessionId,
    };
  });

  return (
    <Box flexDirection="column" borderStyle="single" padding={1}>
      <Text bold>Select session to resume</Text>
      <Text dimColor>{sessions.length} saved</Text>
      <SelectInput items={items} onSelect={(item) => onSelect(item.value)} />
      <Text dimColor>↑↓ to navigate, Enter to resume, Esc to cancel</Text>
    </Box>
  );
}
