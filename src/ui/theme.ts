import { getConfigValue, setConfigValue } from '../lib/config.js';
import type { ChalkInstance } from 'chalk';
import chalk from 'chalk';

export type ThemeName = 'default' | 'ocean' | 'dracula' | 'monokai';

export interface ThemeTokens {
  primary: ChalkInstance;
  secondary: ChalkInstance;
  success: ChalkInstance;
  error: ChalkInstance;
  warning: ChalkInstance;
  info: ChalkInstance;
  muted: ChalkInstance;
  accent: ChalkInstance;
}

const themes: Record<ThemeName, ThemeTokens> = {
  default: {
    primary: chalk.blue,
    secondary: chalk.gray,
    success: chalk.green,
    error: chalk.red,
    warning: chalk.yellow,
    info: chalk.cyan,
    muted: chalk.dim,
    accent: chalk.magenta,
  },
  ocean: {
    primary: chalk.cyan,
    secondary: chalk.blueBright,
    success: chalk.greenBright,
    error: chalk.redBright,
    warning: chalk.yellowBright,
    info: chalk.cyanBright,
    muted: chalk.blue.dim,
    accent: chalk.magentaBright,
  },
  dracula: {
    primary: chalk.hex('#bd93f9'),
    secondary: chalk.hex('#6272a4'),
    success: chalk.hex('#50fa7b'),
    error: chalk.hex('#ff5555'),
    warning: chalk.hex('#f1fa8c'),
    info: chalk.hex('#8be9fd'),
    muted: chalk.hex('#6272a4').dim,
    accent: chalk.hex('#ff79c6'),
  },
  monokai: {
    primary: chalk.hex('#a6e22e'),
    secondary: chalk.hex('#75715e'),
    success: chalk.hex('#a6e22e'),
    error: chalk.hex('#f92672'),
    warning: chalk.hex('#e6db74'),
    info: chalk.hex('#66d9ef'),
    muted: chalk.hex('#75715e').dim,
    accent: chalk.hex('#fd971f'),
  },
};

export function getActiveThemeName(): ThemeName {
  const theme = getConfigValue('theme') as string;
  return (theme && theme in themes) ? (theme as ThemeName) : 'default';
}

export function setActiveThemeName(theme: ThemeName): void {
  setConfigValue('theme', theme);
}

export function getTheme(): ThemeTokens {
  return themes[getActiveThemeName()];
}

export function getAvailableThemes(): ThemeName[] {
  return Object.keys(themes) as ThemeName[];
}
