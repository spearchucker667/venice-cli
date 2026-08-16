/**
 * Plan-exit approval prompt.
 *
 * Exiting plan mode with a proposed plan requires explicit user approval,
 * separate from ordinary tool approval (work order §9). YOLO mode does not
 * bypass this prompt.
 */

import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import type { PlanArtifact } from '../agent/types.js';

export interface PlanApprovalPromptProps {
  plan: PlanArtifact;
  onDecision: (approved: boolean) => void;
}

export function PlanApprovalPrompt({ plan, onDecision }: PlanApprovalPromptProps): JSX.Element {
  const items: Array<{ key: string; label: string; value: boolean }> = [
    { key: 'approve', label: 'Approve plan and start executing', value: true },
    { key: 'revise', label: 'Revise plan (stay in plan mode)', value: false },
  ];

  return (
    <Box flexDirection="column" borderStyle="single" padding={1} borderColor="cyan">
      <Text bold>Approve this plan and leave plan mode?</Text>
      <Text>{plan.summary || '(no summary)'}</Text>
      {plan.steps.map((step) => (
        <Text key={step.id} dimColor>{`  ${step.id}. ${step.text}`}</Text>
      ))}
      <Text dimColor>Plan file: {plan.filePath}</Text>
      <Box marginTop={1}>
        <SelectInput items={items} onSelect={(item) => onDecision(item.value)} />
      </Box>
    </Box>
  );
}
