/**
 * Venice brand tokens and pure display-policy helpers for the TUI greeting.
 *
 * The terminal ASCII mark is a decorative interpretation of the crossed-keys
 * Venice identity. It is not a replacement for the approved logo assets, which
 * are reserved for README and other visual surfaces (docs/assets/...).
 */

export const VENICE_BRAND = {
  deepBlue: '#0E2942',
  midnightBlue: '#0A121A',
  offWhite: '#F7F5ED',
  accentLight: '#3C8FDD',
  accentDark: '#125DA3',
} as const;

export const VENICE_SLOGAN = 'Private and uncensored AI.';

/**
 * Full-size crossed-keys mark (7 rows), traced from the official Venice keys
 * asset: two warded heads at the top whose teeth meet in the middle, shafts
 * crossing in an X, and two bow rings at the bottom.
 */
export const FULL_LOGO = [
  '    /\\  /\\',
  '   /  \\/  \\',
  '   \\      /',
  '    \\    /',
  '     X',
  '   /    \\',
  '  (__)  (__)',
] as const;

/** Compact crossed-keys mark (5 rows) for medium terminals. */
export const COMPACT_LOGO = [
  '  /\\  /\\',
  ' /  \\/  \\',
  '  \\    /',
  '   X',
  ' (_) (_)',
] as const;

/**
 * Progressive-reveal frame steps (count of visible logo rows).
 *
 * Steps land on semantic groups so each reads clearly: the two warded heads
 * and their interlocking teeth (rows 1-2), then the converging shafts, then
 * the X cross, and finally the complete mark with the bow rings.
 */
export const FULL_FRAMES = [2, 4, 6, 7] as const;
export const COMPACT_FRAMES = [2, 4, 5] as const;

/**
 * Single-line crossed-keys glyph for the status bar: two bow rings flanking
 * the crossed shafts. Plain ASCII so it renders on any terminal.
 */
export const STATUS_MARK = '(_)X(_)';

/** Interval (ms) between entrance frames; shared by reveal and accent sweep. */
export const GREETING_FRAME_MS = 60;

/** Columns the accent pass lights per sweep tick. */
export const SWEEP_COLUMNS_PER_TICK = 2;

/**
 * Number of ticks for a one-pass accent sweep across the mark's widest line.
 * The sweep advances `SWEEP_COLUMNS_PER_TICK` columns per tick.
 */
export function accentSweepStepCount(maxWidth: number): number {
  return Math.max(1, Math.ceil(maxWidth / SWEEP_COLUMNS_PER_TICK));
}

/**
 * Column lit by the accent sweep at a 1-based sweep tick. The final tick
 * lights the rightmost column so the wash completes before settling.
 */
export function getAccentSweepCol(maxWidth: number, tick: number, sweepSteps: number): number {
  if (tick >= sweepSteps) return maxWidth - 1;
  return Math.min(maxWidth - 1, (tick - 1) * SWEEP_COLUMNS_PER_TICK);
}

export type GreetingVariant = 'full' | 'compact' | 'minimal';

/**
 * Choose the greeting layout for the current terminal size.
 *
 * full     columns >= 72 and rows >= 26
 * compact  columns >= 48 and rows >= 18
 * minimal  everything smaller
 */
export function getGreetingVariant(columns: number, rows: number): GreetingVariant {
  if (columns >= 72 && rows >= 26) return 'full';
  if (columns >= 48 && rows >= 18) return 'compact';
  return 'minimal';
}

export interface AnimationEnvironment {
  isTTY: boolean;
  term?: string;
  ci?: string;
  noAnimation?: string;
}

/**
 * Determine whether the entrance animation should run.
 *
 * Animation is disabled on non-TTY output, `TERM=dumb`, CI environments, and
 * when `VENICE_NO_ANIMATION` is set to `1`/`true`. `NO_COLOR` disables color
 * only, never animation.
 */
export function shouldAnimateGreeting(env: AnimationEnvironment): boolean {
  if (!env.isTTY) return false;
  if (env.term === 'dumb') return false;
  if (env.ci && env.ci !== '0' && env.ci.toLowerCase() !== 'false') return false;
  if (env.noAnimation === '1' || env.noAnimation?.toLowerCase() === 'true') return false;
  return true;
}

export interface ColorEnvironment {
  isTTY: boolean;
  colorTerm?: string;
  term?: string;
  /** `COLORFGBG`, e.g. "15;0" (light-on-dark) or "0;15" (dark-on-light). */
  colorFgBg?: string;
}

/**
 * Detect ANSI truecolor (24-bit) support. Modern terminals advertise it via
 * `COLORTERM`; a few expose it through `TERM` instead. When truecolor is
 * unavailable we do not emit hex accent colors at all, because an approximate
 * 256-color fallback risks illegibility.
 */
export function supportsTrueColor(env: ColorEnvironment): boolean {
  if (!env.isTTY) return false;
  const colorTerm = env.colorTerm?.toLowerCase() ?? '';
  if (colorTerm === 'truecolor' || colorTerm === '24bit') return true;
  const term = env.term?.toLowerCase() ?? '';
  return term.includes('truecolor') || term.includes('24bit') || term.includes('direct');
}

const ANSI16_RGB: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0], // 0 black
  [128, 0, 0], // 1 red
  [0, 128, 0], // 2 green
  [128, 128, 0], // 3 yellow
  [0, 0, 128], // 4 blue
  [128, 0, 128], // 5 magenta
  [0, 128, 128], // 6 cyan
  [192, 192, 192], // 7 white
  [128, 128, 128], // 8 bright black (gray)
  [255, 0, 0], // 9 bright red
  [0, 255, 0], // 10 bright green
  [255, 255, 0], // 11 bright yellow
  [0, 0, 255], // 12 bright blue
  [255, 0, 255], // 13 bright magenta
  [0, 255, 255], // 14 bright cyan
  [255, 255, 255], // 15 bright white
];

function luminance(rgb: readonly [number, number, number]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

/**
 * Classify the terminal background from `COLORFGBG` (`"<fg>;<bg>"` with ANSI
 * 0-15 indices). Returns `true` for a dark background, `false` for a light
 * one, or `undefined` when the value is absent or unparseable.
 */
export function isDarkBackground(colorFgBg?: string): boolean | undefined {
  if (!colorFgBg) return undefined;
  const fields = colorFgBg.split(/[;:]/);
  const bgIndex = Number.parseInt(fields[fields.length - 1] ?? '', 10);
  if (!Number.isInteger(bgIndex) || bgIndex < 0 || bgIndex > 15) return undefined;
  return luminance(ANSI16_RGB[bgIndex]) < 128;
}

/**
 * The Venetian Blue accent for terminal surfaces, or `undefined` on terminals
 * that cannot render truecolor (so the mark falls back to plain text).
 *
 * Shade follows the terminal background: dark backgrounds use the dark-mode
 * accent, light backgrounds the light-mode accent. An unknown background
 * defaults to the dark-mode shade. `NO_COLOR` is handled by the renderer
 * (chalk) and needs no special case.
 */
export function resolveAccentColor(env: ColorEnvironment): string | undefined {
  if (!supportsTrueColor(env)) return undefined;
  return isDarkBackground(env.colorFgBg) === false
    ? VENICE_BRAND.accentLight
    : VENICE_BRAND.accentDark;
}

export interface GreetingPolicy {
  animate: boolean;
  accentColor: string | undefined;
}

let greetingPolicyCache: GreetingPolicy | undefined;

/**
 * Resolve the greeting animation + accent policy from the live process
 * environment. These values depend only on terminal/environment state that
 * does not change during a process lifetime, so the result is computed once
 * and cached; subsequent calls return the same object without re-reading
 * environment variables.
 */
export function resolveGreetingPolicy(): GreetingPolicy {
  if (greetingPolicyCache === undefined) {
    greetingPolicyCache = {
      animate: shouldAnimateGreeting({
        isTTY: Boolean(process.stdout.isTTY),
        term: process.env.TERM,
        ci: process.env.CI,
        noAnimation: process.env.VENICE_NO_ANIMATION,
      }),
      accentColor: resolveAccentColor({
        isTTY: Boolean(process.stdout.isTTY),
        colorTerm: process.env.COLORTERM,
        term: process.env.TERM,
        colorFgBg: process.env.COLORFGBG,
      }),
    };
  }
  return greetingPolicyCache;
}

/**
 * Clear the cached greeting policy so the next `resolveGreetingPolicy()` call
 * re-reads the environment. This exists for tests that exercise multiple
 * terminal environments in a single process; normal callers never need it.
 */
export function resetGreetingPolicyCache(): void {
  greetingPolicyCache = undefined;
}

/**
 * Return the logo with only `visibleLines` rows shown and the remaining rows
 * blank, so the rest of the UI does not jump vertically during the reveal.
 */
export function getLogoFrame(logo: readonly string[], visibleLines: number): string[] {
  const clamped = Math.max(0, Math.min(visibleLines, logo.length));
  return logo.map((line, index) => (index < clamped ? line : ''));
}
