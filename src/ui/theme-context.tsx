/**
 * React context that makes the active UI theme visible to Ink components.
 *
 * Previously `/theme` only persisted the theme name to config while every Ink
 * component hardcoded its colors, so the command was a dead end (P2). The App
 * owns the theme name state and passes it in; `useTheme()` exposes Ink color
 * tokens and `refreshTheme()` re-renders the tree when `/theme <name>` sets a
 * new theme.
 */

import { createContext, useContext, type ReactNode } from 'react';
import { getInkTheme, type InkTheme, type ThemeName } from './theme.js';

export interface ThemeContextValue {
  themeName: ThemeName;
  ink: InkTheme;
  refreshTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  themeName: 'default',
  ink: getInkTheme('default'),
  refreshTheme: () => {},
});

export function ThemeProvider({
  themeName,
  refreshTheme,
  children,
}: {
  themeName: ThemeName;
  refreshTheme: () => void;
  children: ReactNode;
}): JSX.Element {
  const ink = getInkTheme(themeName);
  return <ThemeContext.Provider value={{ themeName, ink, refreshTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
