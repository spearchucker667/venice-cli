/**
 * Entry point for launching the Ink-based agent TUI.
 */

import { render } from 'ink';
import { App } from './app.js';
import type { AppProps } from './app.js';

export interface TuiOptions extends Omit<AppProps, 'onExit'> {
  initialObjective?: string;
}

export async function runTui(options: TuiOptions): Promise<void> {
  const app = render(<App {...options} onExit={() => app.unmount()} />);
  try {
    await app.waitUntilExit();
  } finally {
    await options.mcpManager?.stop().catch(() => {});
  }
}
