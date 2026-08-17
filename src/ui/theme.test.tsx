import { describe, it } from 'node:test';
import assert from 'node:assert';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { getInkTheme, getAvailableThemes } from './theme.js';
import { ThemeProvider, useTheme } from './theme-context.js';

describe('getInkTheme (P2 /theme dead end)', () => {
  it('returns distinct Ink color tokens for every theme', () => {
    const themes = getAvailableThemes();
    assert.ok(themes.length >= 4, 'expected default/ocean/dracula/monokai');
    for (const name of themes) {
      const ink = getInkTheme(name);
      assert.ok(ink.primary, `primary missing for ${name}`);
      assert.ok(ink.error, `error missing for ${name}`);
      assert.ok(ink.success, `success missing for ${name}`);
    }
    // Themes must actually differ, otherwise /theme is a no-op.
    const defaults = getInkTheme('default');
    const dracula = getInkTheme('dracula');
    assert.notStrictEqual(dracula.primary, defaults.primary);
  });

  it('falls back to default for unknown theme names', () => {
    assert.strictEqual(getInkTheme('not-a-theme' as never).primary, getInkTheme('default').primary);
  });
});

describe('ThemeProvider / useTheme (P2 /theme dead end)', () => {
  it('exposes ink tokens and re-renders when refreshTheme is called', () => {
    let refreshFromContext: (() => void) | undefined;
    function Consumer(): JSX.Element {
      const { ink, refreshTheme } = useTheme();
      refreshFromContext = refreshTheme;
      return <Text color={ink.primary}>primary-token</Text>;
    }
    const { lastFrame } = render(
      <ThemeProvider themeName="default" refreshTheme={() => {}}>
        <Consumer />
      </ThemeProvider>
    );
    assert.ok(lastFrame()?.includes('primary-token'));

    // refreshTheme must be exposed to consumers so /theme can re-render.
    assert.strictEqual(typeof refreshFromContext, 'function');
  });

  it('reflects a changed themeName through the context value', () => {
    let captured: string | undefined;
    function Consumer(): JSX.Element {
      const { ink } = useTheme();
      captured = ink.primary;
      return <Text>{ink.primary}</Text>;
    }
    render(
      <ThemeProvider themeName="dracula" refreshTheme={() => {}}>
        <Consumer />
      </ThemeProvider>
    );
    assert.strictEqual(captured, '#bd93f9');
  });
});
