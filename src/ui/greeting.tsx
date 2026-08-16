/**
 * Brand greeting for the interactive workspace-agent TUI.
 *
 * The greeting is orientation only: it is rendered above the transcript for a
 * new, empty interactive session and never added to session history, model
 * context, event streams, or exported state.
 */

import { useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import path from 'node:path';
import {
  COMPACT_FRAMES,
  COMPACT_LOGO,
  FULL_FRAMES,
  FULL_LOGO,
  VENICE_SLOGAN,
  getGreetingVariant,
  getLogoFrame,
} from './brand.js';

export interface GreetingProps {
  columns: number;
  rows: number;
  model: string;
  workspaceRoot: string;
  gitBranch?: string;
  agentMode: 'agent' | 'chat-only';
  inputMode: 'agent' | 'shell';
  operatingMode: 'agent' | 'plan';
  approvalMode: 'suggest' | 'auto-edit' | 'auto' | 'yolo';
  animate?: boolean;
  /** Venetian Blue accent, or undefined to render the mark/header as plain text. */
  accentColor?: string;
}

function formatMode(
  agentMode: GreetingProps['agentMode'],
  inputMode: GreetingProps['inputMode'],
  operatingMode: GreetingProps['operatingMode'],
): string {
  const parts = [agentMode === 'chat-only' ? 'chat-only' : 'agent'];
  if (agentMode !== 'chat-only') {
    if (operatingMode === 'plan') parts.push('plan');
    if (inputMode === 'shell') parts.push('shell');
  }
  return parts.join(' + ');
}

function compactWorkspace(root: string, branch?: string): string {
  const leaf = path.basename(root) || root;
  return branch ? `${leaf} · ${branch}` : leaf;
}

export function Greeting(props: GreetingProps): JSX.Element {
  const variant = getGreetingVariant(props.columns, props.rows);
  // Minimal terminals never animate, even when animation is otherwise enabled.
  const animate = Boolean(props.animate) && variant !== 'minimal';
  const frames = variant === 'full' ? FULL_FRAMES : COMPACT_FRAMES;
  const logo = variant === 'full' ? FULL_LOGO : COMPACT_LOGO;
  const finalFrame = frames.length - 1;
  const [frameIndex, setFrameIndex] = useState(animate ? 0 : finalFrame);

  useEffect(() => {
    if (!animate) {
      setFrameIndex(finalFrame);
      return;
    }

    let current = 0;
    const timer = setInterval(() => {
      current += 1;
      setFrameIndex(Math.min(current, finalFrame));
      if (current >= finalFrame) clearInterval(timer);
    }, 70);

    return () => clearInterval(timer);
  }, [animate, finalFrame]);

  const visibleLogo = useMemo(
    () => (variant === 'minimal' ? [] : getLogoFrame(logo, frames[Math.min(frameIndex, finalFrame)])),
    [logo, frames, frameIndex, finalFrame, variant],
  );

  if (variant === 'minimal') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold>Venice CLI · {props.model}</Text>
        <Text dimColor>{VENICE_SLOGAN}</Text>
      </Box>
    );
  }

  const mode = formatMode(props.agentMode, props.inputMode, props.operatingMode);

  return (
    <Box flexDirection="column" paddingX={1} marginBottom={1}>
      <Text color={props.accentColor}>{visibleLogo.join('\n')}</Text>
      <Text bold color={props.accentColor}>Venice CLI</Text>
      <Text>{VENICE_SLOGAN}</Text>
      <Text dimColor>Model  {props.model}</Text>
      <Text dimColor>Mode   {mode} · {props.approvalMode}</Text>
      {variant === 'full' && (
        <Text dimColor>Workspace  {compactWorkspace(props.workspaceRoot, props.gitBranch)}</Text>
      )}
      <Text dimColor>
        {variant === 'full' ? '/help commands · /model switch · Ctrl+X shell' : '/help · /model · Ctrl+X'}
      </Text>
    </Box>
  );
}
