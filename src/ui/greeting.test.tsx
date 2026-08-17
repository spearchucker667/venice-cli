import { describe, it } from 'node:test';
import assert from 'node:assert';
import { render } from 'ink-testing-library';
import { Greeting } from './greeting.js';
import {
  COMPACT_LOGO,
  FULL_LOGO,
  VENICE_BRAND,
  VENICE_SLOGAN,
  accentSweepStepCount,
  getAccentSweepCol,
  getGreetingVariant,
  getHeadlessBrandHeader,
  getLogoFrame,
  isDarkBackground,
  resetGreetingPolicyCache,
  resolveAccentColor,
  resolveGreetingPolicy,
  shouldAnimateGreeting,
  supportsTrueColor,
} from './brand.js';

describe('brand display policy', () => {
  it('shouldAnimateGreeting honors TTY/TERM/CI/opt-out', () => {
    assert.equal(shouldAnimateGreeting({ isTTY: true }), true);
    assert.equal(shouldAnimateGreeting({ isTTY: false }), false);
    assert.equal(shouldAnimateGreeting({ isTTY: true, term: 'dumb' }), false);
    assert.equal(shouldAnimateGreeting({ isTTY: true, term: 'xterm-256color' }), true);
    assert.equal(shouldAnimateGreeting({ isTTY: true, ci: '1' }), false);
    assert.equal(shouldAnimateGreeting({ isTTY: true, ci: 'true' }), false);
    assert.equal(shouldAnimateGreeting({ isTTY: true, ci: '0' }), true);
    assert.equal(shouldAnimateGreeting({ isTTY: true, ci: 'false' }), true);
    assert.equal(shouldAnimateGreeting({ isTTY: true, noAnimation: '1' }), false);
    assert.equal(shouldAnimateGreeting({ isTTY: true, noAnimation: 'true' }), false);
    assert.equal(shouldAnimateGreeting({ isTTY: true, noAnimation: 'TRUE' }), false);
    assert.equal(shouldAnimateGreeting({ isTTY: true, noAnimation: '0' }), true);
  });

  it('supportsTrueColor detects 24-bit terminals and rejects non-TTY/plain TERM', () => {
    assert.equal(supportsTrueColor({ isTTY: true, colorTerm: 'truecolor' }), true);
    assert.equal(supportsTrueColor({ isTTY: true, colorTerm: '24bit' }), true);
    assert.equal(supportsTrueColor({ isTTY: true, term: 'xterm-truecolor' }), true);
    assert.equal(supportsTrueColor({ isTTY: true, term: 'wezterm-24bit' }), true);
    assert.equal(supportsTrueColor({ isTTY: false, colorTerm: 'truecolor' }), false);
    assert.equal(supportsTrueColor({ isTTY: true, term: 'xterm-256color' }), false);
    assert.equal(supportsTrueColor({ isTTY: true }), false);
  });

  it('isDarkBackground classifies COLORFGBG backgrounds', () => {
    assert.equal(isDarkBackground('15;0'), true); // light-on-dark
    assert.equal(isDarkBackground('7;0'), true);
    assert.equal(isDarkBackground('0;15'), false); // dark-on-light
    assert.equal(isDarkBackground('0;7'), false);
    assert.equal(isDarkBackground('default;default'), undefined);
    assert.equal(isDarkBackground(''), undefined);
    assert.equal(isDarkBackground(undefined), undefined);
    assert.equal(isDarkBackground('rgb:ffff/0000'), undefined);
  });

  it('resolveAccentColor picks the shade from the terminal background', () => {
    assert.equal(resolveAccentColor({ isTTY: true, colorTerm: 'truecolor', colorFgBg: '15;0' }), VENICE_BRAND.accentDark);
    assert.equal(resolveAccentColor({ isTTY: true, colorTerm: 'truecolor', colorFgBg: '0;15' }), VENICE_BRAND.accentLight);
    assert.equal(resolveAccentColor({ isTTY: true, colorTerm: 'truecolor' }), VENICE_BRAND.accentDark); // unknown -> dark default
    assert.equal(resolveAccentColor({ isTTY: true, term: 'xterm-256color', colorFgBg: '0;15' }), undefined);
    assert.equal(resolveAccentColor({ isTTY: false, colorTerm: 'truecolor', colorFgBg: '0;15' }), undefined);
  });

  it('resolveGreetingPolicy computes once and returns a stable cached result', () => {
    resetGreetingPolicyCache();
    const first = resolveGreetingPolicy();
    const second = resolveGreetingPolicy();
    assert.strictEqual(first, second); // same cached object
    assert.equal(typeof first.animate, 'boolean');
    assert.ok(first.accentColor === undefined || typeof first.accentColor === 'string');
    resetGreetingPolicyCache();
  });

  it('resetGreetingPolicyCache re-reads the environment for each resolution', () => {
    // Snapshot every environment variable the policy reads so the test is
    // hermetic on any runner (CI sets CI=true, which would disable animation).
    const previous = {
      CI: process.env.CI,
      TERM: process.env.TERM,
      COLORTERM: process.env.COLORTERM,
      COLORFGBG: process.env.COLORFGBG,
      VENICE_NO_ANIMATION: process.env.VENICE_NO_ANIMATION,
    };
    const isTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    try {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      // Define a complete, deterministic environment: no CI, a normal TERM,
      // truecolor, and animation enabled.
      delete process.env.CI;
      process.env.TERM = 'xterm-256color';
      process.env.COLORTERM = 'truecolor';
      delete process.env.VENICE_NO_ANIMATION;

      // Dark background resolves the dark-mode shade.
      process.env.COLORFGBG = '15;0';
      resetGreetingPolicyCache();
      const dark = resolveGreetingPolicy();
      assert.equal(dark.animate, true);
      assert.equal(dark.accentColor, VENICE_BRAND.accentDark);

      // Light background resolves the light-mode shade after a reset.
      process.env.COLORFGBG = '0;15';
      resetGreetingPolicyCache();
      const light = resolveGreetingPolicy();
      assert.equal(light.accentColor, VENICE_BRAND.accentLight);
      assert.notStrictEqual(dark, light);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      if (isTTYDescriptor) Object.defineProperty(process.stdout, 'isTTY', isTTYDescriptor);
      else Reflect.deleteProperty(process.stdout, 'isTTY');
      resetGreetingPolicyCache();
    }
  });

  it('getGreetingVariant selects full/compact/minimal by size', () => {
    assert.equal(getGreetingVariant(120, 40), 'full');
    assert.equal(getGreetingVariant(72, 26), 'full');
    assert.equal(getGreetingVariant(60, 22), 'compact');
    assert.equal(getGreetingVariant(48, 18), 'compact');
    assert.equal(getGreetingVariant(40, 16), 'minimal');
    assert.equal(getGreetingVariant(80, 10), 'minimal');
  });

  it('getHeadlessBrandHeader mirrors the greeting mark plus wordmark and slogan', () => {
    const header = getHeadlessBrandHeader();
    assert.deepStrictEqual(header.slice(0, FULL_LOGO.length), [...FULL_LOGO]);
    assert.strictEqual(header[FULL_LOGO.length], 'Venice CLI');
    assert.strictEqual(header[FULL_LOGO.length + 1], VENICE_SLOGAN);
    for (const line of header) {
      assert.match(line, /^[ -~]*$/, `headless brand header must be plain ASCII: ${JSON.stringify(line)}`);
    }
  });

  it('accentSweepStepCount covers the full logo width in two-column steps', () => {
    assert.equal(accentSweepStepCount(12), 6);
    assert.equal(accentSweepStepCount(9), 5);
    assert.equal(accentSweepStepCount(1), 1);
    assert.equal(accentSweepStepCount(0), 1);
  });

  it('getAccentSweepCol advances two columns per tick and completes the wash', () => {
    const steps = accentSweepStepCount(12);
    assert.equal(getAccentSweepCol(12, 1, steps), 0);
    assert.equal(getAccentSweepCol(12, 2, steps), 2);
    assert.equal(getAccentSweepCol(12, 3, steps), 4);
    // The final tick lights the rightmost column so the mark is fully washed.
    assert.equal(getAccentSweepCol(12, steps, steps), 11);
    // A column never exceeds the logo width.
    assert.ok(getAccentSweepCol(12, 99, steps) <= 11);
  });

  it('getLogoFrame pads remaining rows to avoid layout jump', () => {
    const frame = getLogoFrame(FULL_LOGO, 2);
    assert.deepEqual(frame.slice(0, 2), [FULL_LOGO[0], FULL_LOGO[1]]);
    assert.deepEqual(frame.slice(2), FULL_LOGO.slice(2).map(() => ''));
    assert.deepEqual(getLogoFrame(COMPACT_LOGO, COMPACT_LOGO.length), [...COMPACT_LOGO]);
    assert.deepEqual(getLogoFrame(FULL_LOGO, 999), [...FULL_LOGO]);
  });

  it('the mark is plain ASCII and evokes the crossed-keys asset', () => {
    const all = [...FULL_LOGO, ...COMPACT_LOGO];
    for (const line of all) {
      assert.match(line, /^[ -~]*$/, `logo line must be plain ASCII: ${JSON.stringify(line)}`);
      assert.ok(line.length <= 24, `logo line too wide: ${JSON.stringify(line)}`);
    }
    const full = FULL_LOGO.join('\n');
    assert.ok(full.includes('X'), 'full mark must show the crossed shafts');
    assert.ok(full.includes('(_'), 'full mark must show the key bows');
  });
});

describe('Greeting', () => {
  const baseProps = {
    model: 'test-model',
    workspaceRoot: '/tmp/venice-cli',
    gitBranch: 'main',
    agentMode: 'agent' as const,
    inputMode: 'agent' as const,
    operatingMode: 'agent' as const,
    approvalMode: 'suggest' as const,
    animate: false,
  };

  it('renders identity, slogan, model, mode, and workspace in full variant', () => {
    const { lastFrame, unmount } = render(<Greeting {...baseProps} columns={120} rows={40} />);
    const frame = lastFrame() ?? '';
    assert.ok(frame.includes('Venice CLI'));
    assert.ok(frame.includes(VENICE_SLOGAN));
    assert.ok(frame.includes('test-model'));
    assert.ok(frame.includes('suggest'));
    assert.ok(frame.includes('venice-cli · main'));
    unmount();
  });

  it('omits the workspace line in compact variant', () => {
    const { lastFrame, unmount } = render(<Greeting {...baseProps} columns={60} rows={22} />);
    const frame = lastFrame() ?? '';
    assert.ok(frame.includes('Venice CLI'));
    assert.ok(frame.includes('test-model'));
    assert.ok(!frame.includes('Workspace'));
    unmount();
  });

  it('renders a one-line identity in minimal variant', () => {
    const { lastFrame, unmount } = render(<Greeting {...baseProps} columns={40} rows={16} />);
    const frame = lastFrame() ?? '';
    assert.ok(frame.includes('Venice CLI · test-model'));
    unmount();
  });

  it('does not advertise tools for a chat-only model', () => {
    const { lastFrame, unmount } = render(
      <Greeting {...baseProps} agentMode="chat-only" columns={120} rows={40} />,
    );
    const frame = lastFrame() ?? '';
    assert.ok(frame.includes('chat-only'));
    assert.ok(!frame.includes('agent +'));
    unmount();
  });

  it('animation settles on the complete mark after reveal and sweep', async () => {
    const { lastFrame, unmount } = render(
      <Greeting {...baseProps} animate accentColor={VENICE_BRAND.accentDark} columns={120} rows={40} />,
    );
    // Reveal (4 ticks) + sweep (6 ticks) at 60 ms each, with slack for the
    // interval timer under load.
    await new Promise((resolve) => setTimeout(resolve, 900));
    const frame = lastFrame() ?? '';
    for (const line of FULL_LOGO) {
      assert.ok(frame.includes(line), `settled frame must contain ${JSON.stringify(line)}`);
    }
    unmount();
  });

  it('no accent color means no sweep phase and a stable plain mark', async () => {
    const { lastFrame, unmount } = render(
      <Greeting {...baseProps} animate columns={120} rows={40} />,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    const frame = lastFrame() ?? '';
    for (const line of FULL_LOGO) {
      assert.ok(frame.includes(line), `settled frame must contain ${JSON.stringify(line)}`);
    }
    unmount();
  });
});
