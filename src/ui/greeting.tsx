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
  GREETING_FRAME_MS,
  VENICE_SLOGAN,
  accentSweepStepCount,
  getAccentSweepCol,
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

type GreetingPhase = 'reveal' | 'sweep' | 'done';

/**
 * Render one logo line with every character at column <= `sweepCol` tinted
 * with the accent color and the rest plain, so the accent appears to wash
 * across the mark from left to right.
 */
function renderSweptLine(line: string, sweepCol: number, accentColor: string): JSX.Element {
  return (
    <Text>
      {line.split('').map((char, index) =>
        char !== ' ' && index <= sweepCol ? (
          <Text key={index} color={accentColor}>
            {char}
          </Text>
        ) : (
          <Text key={index}>{char}</Text>
        ),
      )}
    </Text>
  );
}

export function Greeting(props: GreetingProps): JSX.Element {
  const variant = getGreetingVariant(props.columns, props.rows);
  // Minimal terminals never animate, even when animation is otherwise enabled.
  const animate = Boolean(props.animate) && variant !== 'minimal';
  const frames = variant === 'full' ? FULL_FRAMES : COMPACT_FRAMES;
  const logo = variant === 'full' ? FULL_LOGO : COMPACT_LOGO;
  const finalFrame = frames.length - 1;
  // The accent sweep is a color-only pass: it needs a truecolor accent and a
  // live animation. Without either, the mark stays plain and static.
  const canSweep = animate && Boolean(props.accentColor);
  const logoWidth = logo.length > 0 ? Math.max(...logo.map((line) => line.length)) : 0;
  const sweepSteps = accentSweepStepCount(logoWidth);
  const [phase, setPhase] = useState<GreetingPhase>(canSweep ? 'reveal' : 'done');
  const [frameIndex, setFrameIndex] = useState(animate ? 0 : finalFrame);
  const [sweepCol, setSweepCol] = useState(-1);

  useEffect(() => {
    if (!animate) {
      setPhase('done');
      setFrameIndex(finalFrame);
      setSweepCol(-1);
      return;
    }

    const revealTicks = finalFrame;
    const sweepTicks = canSweep ? sweepSteps : 0;
    let current = 0;
    const timer = setInterval(() => {
      current += 1;
      if (current <= revealTicks) {
        setPhase('reveal');
        setFrameIndex(current);
      } else if (current <= revealTicks + sweepTicks) {
        setPhase('sweep');
        setFrameIndex(finalFrame);
        setSweepCol(getAccentSweepCol(logoWidth, current - revealTicks, sweepSteps));
      } else {
        // Settle on the stable frame; no timer survives past this point.
        setPhase('done');
        setSweepCol(-1);
        clearInterval(timer);
      }
    }, GREETING_FRAME_MS);

    return () => clearInterval(timer);
  }, [animate, canSweep, finalFrame, logoWidth, sweepSteps]);

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
  // The reveal renders the mark plain so the one-pass sweep is visible as the
  // accent washes across from left to right, then the stable frame settles on
  // the fully-accented mark. Per-character rendering is only paid for while
  // the sweep is actually running.
  const sweeping = phase === 'sweep' && Boolean(props.accentColor) && sweepCol >= 0;
  const settled = phase === 'done';

  return (
    <Box flexDirection="column" paddingX={1} marginBottom={1}>
      {sweeping ? (
        <Text>
          {visibleLogo.map((line, index) => (
            <Text key={index}>
              {renderSweptLine(line, sweepCol, props.accentColor as string)}
              {index < visibleLogo.length - 1 ? '\n' : ''}
            </Text>
          ))}
        </Text>
      ) : (
        <Text color={settled ? props.accentColor : undefined}>{visibleLogo.join('\n')}</Text>
      )}
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
