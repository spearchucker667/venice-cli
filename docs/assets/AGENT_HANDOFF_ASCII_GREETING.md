# Venice CLI Brand Refresh and Animated ASCII Greeting — Agent Handoff

## Role

Act as the senior maintainer for the Venice CLI repository. Implement a polished, brand-aware terminal greeting and integrate the supplied README/brand assets without weakening existing agent, permission, session, security, CI, or non-interactive behavior.

This is a repository change, not a mockup. Inspect the live tree before editing, verify assumptions against the current implementation, make the smallest coherent production change, add tests, and run the repository's validation gates.

## Repository and local paths

Repository:

```text
https://github.com/spearchucker667/venice-cli
```

Local workspace:

```text
/Users/super_user/Projects/venice-cli/
```

This package is expected to be unpacked at:

```text
/Users/super_user/Projects/venice-cli/docs/assets/venice-cli-brand-refresh/
```

Package contents:

```text
docs/assets/venice-cli-brand-refresh/
├── README.md                         # candidate replacement for repo-root README.md
├── AGENT_HANDOFF_ASCII_GREETING.md  # this implementation handoff
└── brand/
    ├── DESIGN.md
    ├── venice-brand-guidelines.pdf
    ├── logos/
    │   ├── wordmark/
    │   ├── keys/
    │   └── lockup/
    └── executives/
```

Do not assume the full package should be committed just because it exists inside the working tree. The full kit is supplied as implementation/reference material. Review asset licensing, repository size, and actual README needs before deciding which files belong in Git history. At minimum, preserve the logo files referenced by the final README.

## Current repository facts to verify first

At the time this handoff was prepared, the current fork exposed the following structure and behavior:

- package name: `@spearchucker667/venice-cli`
- package version observed: `2.1.0`
- executable: `venice`
- TypeScript ESM project
- Ink 5 + React 18 terminal UI
- `chalk` is already a dependency
- top-level interactive TUI: `src/ui/app.tsx`
- status bar: `src/ui/status.tsx`
- existing TUI test: `src/ui/app.test.tsx`
- current CI workflow: `.github/workflows/ci.yml`
- current publish workflow: `.github/workflows/publish.yml`
- package supports Node `>=18.0.0`; development tooling is stricter because of ESLint 10
- the current `App` receives `workspaceRoot`, `model`, `approvalMode`, optional runtime mode, max turns, MCP manager, optional initial objective, optional resume session ID, and exit callback
- the current `App` tracks active model, model profile, permission mode, input mode, operating mode, Git branch, status, transcript messages, pickers, and approvals
- `StatusBar` already displays model/mode/location/approval/status/context data and has narrow-terminal handling

These facts can drift. Treat the working tree as authoritative.

## First action: inspect before editing

Start with:

```bash
set -euo pipefail
cd "/Users/super_user/Projects/venice-cli"

printf '\n=== repository ===\n'
git rev-parse --show-toplevel
git status --short
git branch --show-current
git log -1 --oneline

printf '\n=== runtime ===\n'
node --version
npm --version

printf '\n=== package ===\n'
node -e 'const p=require("./package.json"); console.log({name:p.name,version:p.version,engines:p.engines,scripts:p.scripts,dependencies:p.dependencies})'

printf '\n=== supplied brand package ===\n'
ASSET_ROOT="$PWD/docs/assets/venice-cli-brand-refresh"
test -f "$ASSET_ROOT/README.md"
test -f "$ASSET_ROOT/brand/DESIGN.md"
test -f "$ASSET_ROOT/brand/venice-brand-guidelines.pdf"
find "$ASSET_ROOT/brand/logos" -maxdepth 2 -type f | sort

printf '\n=== relevant TUI files ===\n'
sed -n '1,240p' src/ui/app.tsx
sed -n '1,220p' src/ui/status.tsx
sed -n '1,220p' src/ui/app.test.tsx
```

Also inspect any current UI helpers, renderer utilities, theme/color helpers, test conventions, and existing animation/timer code before introducing new abstractions:

```bash
find src/ui -maxdepth 1 -type f | sort
rg -n "setInterval|setTimeout|useEffect|NO_COLOR|isTTY|TERM|CI|chalk|color=|borderStyle" src test* scripts package.json || true
```

If the local tree differs materially from this handoff, adapt to the current architecture instead of forcing stale file names or snippets.

## Brand source of truth

Read both:

```text
docs/assets/venice-cli-brand-refresh/brand/DESIGN.md
docs/assets/venice-cli-brand-refresh/brand/venice-brand-guidelines.pdf
```

Important constraints from the supplied brand system:

- primary brand essence/slogan: `Private and uncensored AI.`
- use approved logo files for visual brand surfaces
- do not redraw, stretch, distort, outline, fade, add shadows/effects to, or crowd the official logo assets
- the crossed keys are the compact mark
- Deep Blue: `#0E2942`
- Midnight Blue: `#0A121A`
- Off White: `#F7F5ED`
- Venetian Blue: `#3C8FDD` in light mode / `#125DA3` in dark mode
- Venetian Blue is an accent, not a logo color
- headers should use sentence case rather than shouty all-caps treatment

The README must use official image assets. The terminal ASCII mark is an explicit exception for a text-only terminal surface: treat it as a decorative interpretation, never as a replacement source logo.

## Mission

Deliver all of the following as one coherent change:

1. Add a polished Venice greeting to the interactive workspace-agent TUI.
2. Include a compact ASCII interpretation of the crossed-keys Venice identity.
3. Animate the greeting briefly on interactive terminals, then stop on a stable frame.
4. Display the active agent/model context in the greeting.
5. Display the Venice slogan exactly as supplied by the brand system.
6. Preserve small-terminal usability and non-interactive determinism.
7. Add deterministic unit/component tests for the greeting and its animation policy.
8. Replace the repository-root `README.md` with the supplied candidate only after reconciling it with the final implementation and current command surface.
9. Use official Venice assets for README presentation.
10. Run all relevant validation and report exact results.

## Desired terminal experience

The final design should feel like a first-class CLI, not a splash screen bolted onto the transcript.

A representative stable frame:

```text
       \       /
        \  /\ /
         \ / /
          X
         / \
      __/   \__
     (__)   (__)

Venice CLI
Private and uncensored AI.

Model      kimi-k2-5
Mode       agent · auto-edit
Workspace  venice-cli · main

/help commands  /model switch  Ctrl+X shell
```

This is a design reference, not mandatory byte-for-byte output. Preserve the information hierarchy and terminal ergonomics.

The greeting should communicate, in this order:

1. Venice identity / compact ASCII keys
2. `Venice CLI` header
3. `Private and uncensored AI.`
4. active model
5. active runtime mode and approval mode
6. workspace identity and Git branch where available
7. concise control hint

Do not duplicate every status-bar field. The greeting is orientation; the status bar remains the persistent live-state surface.

## Responsive variants

Implement explicit responsive variants instead of allowing the full greeting to wrap unpredictably.

Recommended policy:

```text
full     columns >= 72 and rows >= 26
compact  columns >= 48 and rows >= 18
minimal  everything smaller
```

Suggested behavior:

- `full`: full ASCII mark, slogan, model, mode, workspace, hint
- `compact`: smaller ASCII mark, slogan, model, mode, short hint
- `minimal`: `Venice CLI · <model>` plus the slogan or a one-line control hint; no animation if the terminal is too constrained

Do not render a decorative box if the box itself causes wrapping or consumes too much vertical space.

## Animation behavior

The animation must be an entrance animation, not an infinite spinner.

Target characteristics:

- duration: roughly 250-550 ms total
- 4-7 frames
- frame interval: roughly 50-90 ms
- final frame remains static
- no timer continues after the final frame
- no timer survives component unmount
- no animation-driven transcript mutation
- no blocking sleep
- no cursor control outside Ink
- no direct writes to `process.stdout` from the component
- no external animation dependency unless the repository already has an appropriate one

The easiest robust animation is progressive reveal plus one accent pass. Do not morph the geometry into unrelated shapes.

Example frame strategy:

```ts
const LOGO_LINES = [
  '       \\       /',
  '        \\  /\\ /',
  '         \\ / /',
  '          X',
  '         / \\',
  '      __/   \\__',
  '     (__)   (__)',
];

const FRAMES = [
  2, // reveal top
  4,
  6,
  7, // complete logo
];
```

A frame renderer can show the first `N` lines, pad the remaining logo rows with blank lines so the rest of the UI does not jump vertically, then settle on the complete mark.

A second acceptable strategy is to keep geometry static while an accent marker moves across selected characters. If you do that, never animate indefinitely and never reduce readability.

## Animation opt-out and non-TTY policy

Add a small pure helper so the policy is testable.

Recommended semantics:

```ts
export interface AnimationEnvironment {
  isTTY: boolean;
  term?: string;
  ci?: string;
  noAnimation?: string;
}

export function shouldAnimateGreeting(env: AnimationEnvironment): boolean {
  if (!env.isTTY) return false;
  if (env.term === 'dumb') return false;
  if (env.ci && env.ci !== '0' && env.ci.toLowerCase() !== 'false') return false;
  if (env.noAnimation === '1' || env.noAnimation?.toLowerCase() === 'true') return false;
  return true;
}
```

Wire it from runtime environment:

```ts
const animate = shouldAnimateGreeting({
  isTTY: Boolean(process.stdout.isTTY),
  term: process.env.TERM,
  ci: process.env.CI,
  noAnimation: process.env.VENICE_NO_ANIMATION,
});
```

`NO_COLOR` should disable color, not necessarily animation. `VENICE_NO_ANIMATION=1` should disable animation. Keep these concerns separate.

If the project already has centralized environment parsing, use it rather than duplicating logic.

## Suggested component architecture

Prefer a dedicated component instead of expanding `App` with logo strings and timer logic.

Recommended new files:

```text
src/ui/greeting.tsx
src/ui/greeting.test.tsx
```

Optional only if the codebase benefits from it:

```text
src/ui/brand.ts
```

Do not add a new directory hierarchy for two small files unless existing conventions justify it.

Suggested props:

```ts
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
}
```

Do not pass the entire runtime object into the greeting. It is a view component and should receive only display state.

## Example component skeleton

Adapt this to the actual Ink typings and repository style. Do not paste it blindly.

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import path from 'node:path';

const SLOGAN = 'Private and uncensored AI.';

const LOGO = [
  '       \\       /',
  '        \\  /\\ /',
  '         \\ / /',
  '          X',
  '         / \\',
  '      __/   \\__',
  '     (__)   (__)',
] as const;

function compactWorkspace(root: string, branch?: string): string {
  const leaf = path.basename(root) || root;
  return branch ? `${leaf} · ${branch}` : leaf;
}

export function Greeting(props: GreetingProps): JSX.Element {
  const variant = getGreetingVariant(props.columns, props.rows);
  const frameCount = variant === 'full' ? 4 : variant === 'compact' ? 3 : 1;
  const [frame, setFrame] = useState(props.animate ? 0 : frameCount - 1);

  useEffect(() => {
    if (!props.animate || frameCount <= 1) {
      setFrame(frameCount - 1);
      return;
    }

    let current = 0;
    const timer = setInterval(() => {
      current += 1;
      setFrame(Math.min(current, frameCount - 1));
      if (current >= frameCount - 1) clearInterval(timer);
    }, 70);

    return () => clearInterval(timer);
  }, [props.animate, frameCount]);

  const visibleLogo = useMemo(
    () => getLogoFrame(LOGO, frame, frameCount, variant),
    [frame, frameCount, variant],
  );

  if (variant === 'minimal') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold>Venice CLI · {props.model}</Text>
        <Text dimColor>{SLOGAN}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} marginBottom={1}>
      <Text>{visibleLogo.join('\n')}</Text>
      <Text bold>Venice CLI</Text>
      <Text>{SLOGAN}</Text>
      <Text dimColor>Model      {props.model}</Text>
      <Text dimColor>
        Mode       {formatMode(props)} · {props.approvalMode}
      </Text>
      {variant === 'full' && (
        <Text dimColor>
          Workspace  {compactWorkspace(props.workspaceRoot, props.gitBranch)}
        </Text>
      )}
      <Text dimColor>/help commands · /model switch · Ctrl+X shell</Text>
    </Box>
  );
}
```

Important: check the actual Ink version's color prop support before using hex strings. If exact hex colors are supported by the installed Ink typings/runtime, use the supplied brand tokens. If not, use the nearest built-in terminal color/fallback through an existing theme layer. Do not add raw ANSI escapes that break Ink width measurement.

## Brand color implementation

If the current UI has no theme helper, keep this small.

Suggested tokens:

```ts
export const VENICE_BRAND = {
  deepBlue: '#0E2942',
  midnightBlue: '#0A121A',
  offWhite: '#F7F5ED',
  accentLight: '#3C8FDD',
  accentDark: '#125DA3',
} as const;
```

Terminal rules:

- never recolor the README/logo assets themselves
- use Venetian Blue only as an accent
- default text should remain readable in the user's terminal theme
- `NO_COLOR` must remain respected
- do not paint large terminal background blocks Midnight Blue; terminal users control their background
- do not assume truecolor support
- if the terminal cannot express brand colors reliably, prefer legibility over approximate decorative coloring

## App integration

Integrate the greeting near the top of `src/ui/app.tsx`, but do not turn it into a transcript message.

The greeting should appear only for a new, empty interactive session. It should not pollute session history, restored messages, token context, event streams, or exported session state.

Recommended condition:

```ts
const hasInitialObjective = Boolean(initialObjective?.trim());
const showGreeting =
  !hasInitialObjective &&
  !resumeSessionId &&
  messages.length === 0 &&
  pickerMode === 'normal';
```

Then render it before `Transcript`:

```tsx
{showGreeting && (
  <Greeting
    columns={columns}
    rows={rows}
    model={currentModel}
    workspaceRoot={workspaceRoot}
    gitBranch={gitBranch}
    agentMode={currentModelProfile?.mode ?? runtimeRef.current?.getState().agentMode ?? 'agent'}
    inputMode={inputMode}
    operatingMode={operatingMode}
    approvalMode={currentApprovalMode}
    animate={shouldAnimateGreeting({
      isTTY: Boolean(process.stdout.isTTY),
      term: process.env.TERM,
      ci: process.env.CI,
      noAnimation: process.env.VENICE_NO_ANIMATION,
    })}
  />
)}
```

If `messages.length === 0` changes because the runtime emits an event before the user has typed anything, choose a better explicit `hasUserInteracted` or `greetingDismissed` state. The requirement is semantic: show the greeting at initial interactive startup, then clear it once the session begins. Do not make it flicker based on incidental runtime events.

### Do not change runtime semantics to implement a banner

Do not:

- add a fake transcript event to display the greeting
- mutate runtime/session state for animation
- send the logo to the model
- write the greeting into local history
- persist animation frame state
- alter tool approval semantics
- alter agent mode or model selection behavior
- delay runtime initialization until animation completes

## Vertical layout

The current `App` owns a fixed terminal-sized Ink column and computes transcript limits from row count. A greeting consumes vertical space only while the transcript is empty, so preserve space for:

- composer
- status bar
- approval/plan prompts
- model/session picker when open
- errors

Do not hard-code a 15-line greeting into a 16-line terminal.

If necessary, define a pure helper:

```ts
export function getGreetingVariant(columns: number, rows: number) {
  if (columns >= 72 && rows >= 26) return 'full' as const;
  if (columns >= 48 && rows >= 18) return 'compact' as const;
  return 'minimal' as const;
}
```

When a picker or approval prompt opens, hiding the greeting is acceptable and preferable to crowding the control surface.

## Model and agent labels

Use the actual active model state, not a hardcoded model name.

Model:

```text
currentModel
```

Agent mode should be derived from the same source already used by `StatusBar`:

```text
currentModelProfile?.mode
runtimeRef.current?.getState().agentMode
```

Suggested display strings:

```text
agent
chat-only
agent + plan
agent + shell
agent + plan + shell
```

Do not advertise tool capability when the selected model is `chat-only`.

## Workspace label

Prefer the repository leaf name and current Git branch:

```text
venice-cli · main
```

Do not print the entire absolute home path in the greeting unless there is no useful shorter representation. The persistent status bar already has a path-shortening strategy; reuse or extract that logic if appropriate rather than creating inconsistent path formatting.

If extracting `shortenPath` from `status.tsx`, do it carefully and add tests. Do not refactor unrelated status logic merely to avoid five lines of duplication.

## ASCII-art requirements

The terminal mark must:

- be composed of plain ASCII characters in its core geometry
- evoke crossed keys without pretending to be the canonical source artwork
- fit within the responsive target widths
- remain recognizable without color
- render correctly in common monospace terminals
- avoid combining characters, emoji width ambiguity, and full-width Unicode glyphs in the logo geometry
- not rely on terminal ligatures
- not use a huge FIGlet wordmark that dominates the UI

The header text should be `Venice CLI` in normal case. Do not make an all-caps ASCII wordmark the primary heading.

The stable logo should be declared as a literal array/string in source so it is reviewable and testable. Do not generate it algorithmically from the PNG/SVG at runtime.

## Tests

Add focused deterministic tests. Animation tests must not depend on real-time terminal rendering more than necessary.

### 1. Stable greeting content

Verify that with animation disabled the component contains:

- `Venice CLI`
- `Private and uncensored AI.`
- supplied model name
- supplied approval/runtime mode
- workspace label in full variant

### 2. Responsive variants

Test at least:

```text
120 x 40 -> full
72 x 26  -> full
60 x 22  -> compact
40 x 16  -> minimal
```

Verify no rendered line exceeds the intended width after Ink rendering where practical.

### 3. Animation policy

Pure helper table:

```text
TTY + normal TERM + no opt-out -> true
non-TTY                       -> false
TERM=dumb                     -> false
CI=1                          -> false
VENICE_NO_ANIMATION=1         -> false
VENICE_NO_ANIMATION=true      -> false
```

### 4. Timer cleanup

If using fake timers is awkward with the repository's Node test stack, design the frame progression as a pure function and keep the React timer test minimal. At minimum, ensure unmount does not leave an active interval.

### 5. App startup

Update `src/ui/app.test.tsx` to verify a new blank app contains the greeting and composer. Keep the test independent of live API calls.

Example expectation:

```ts
assert.ok(frame.includes('Venice CLI'));
assert.ok(frame.includes('Private and uncensored AI.'));
assert.ok(frame.includes('test-model'));
assert.ok(frame.includes('>'));
```

Set `VENICE_NO_ANIMATION=1` for deterministic test rendering or pass `animate={false}` at the component boundary where appropriate.

### 6. Resume/noninteractive semantics

Where feasible, verify that the greeting is not serialized as a transcript/session message and is not printed by non-interactive agent runs.

## README integration

The package includes:

```text
docs/assets/venice-cli-brand-refresh/README.md
```

This is a candidate replacement for:

```text
/Users/super_user/Projects/venice-cli/README.md
```

Before replacing anything:

```bash
cd "/Users/super_user/Projects/venice-cli"
cp README.md "/tmp/venice-cli-README.before-brand-refresh.$(date +%Y%m%d-%H%M%S).md"
```

Review the candidate against the current CLI:

```bash
npm run build
node dist/index.js --help
```

Spot-check every command named in the README against Commander registration/current help. Remove or correct stale commands; do not preserve a polished but false README.

Then copy the reconciled candidate into place:

```bash
cp docs/assets/venice-cli-brand-refresh/README.md README.md
```

If you made corrections while reconciling command names/options, make them in the repo-root `README.md` and also update the packaged candidate so the two do not drift during this handoff.

### README asset paths

The supplied README expects assets at:

```text
docs/assets/venice-cli-brand-refresh/brand/logos/...
```

Do not change those paths unless you also update the README consistently.

The hero uses the official wordmark with light/dark `<picture>` sources. The footer uses the official keys mark.

Do not convert those images into base64 data URIs. Keep Git diffs and browser caching sane.

## Asset retention decision

The package includes more material than the README needs, including executive headshots and the full PDF guideline deck.

Before committing, decide deliberately:

### Minimum repo-facing set

Recommended if repository size/licensing cleanliness matters:

```text
brand/DESIGN.md
brand/logos/wordmark/venice-wordmark-on-off-white.png
brand/logos/wordmark/venice-wordmark-on-midnight-blue.png
brand/logos/keys/venice-keys-on-off-white.png
brand/logos/keys/venice-keys-on-midnight-blue.png
```

Optionally retain SVG equivalents for future high-resolution use.

### Full local reference set

Keep the complete package in the local working tree if it is useful to the maintainer, but do not automatically commit:

```text
brand/executives/
brand/venice-brand-guidelines.pdf
all unused logo variants
```

Do not delete the user's supplied source kit outside this package.

## README quality checks

Validate:

- all relative links resolve
- all referenced logo files exist
- GitHub light/dark image sources point to valid paths
- installation uses `@spearchucker667/venice-cli`
- clone URL points to `https://github.com/spearchucker667/venice-cli.git`
- CI badge points to `.github/workflows/ci.yml`
- license is MIT if that remains true in the working tree
- documented Node requirement matches `package.json`
- commands/options match current `--help`
- no claim says every model supports every feature
- secure-execution claims are capability-scoped
- the ASCII greeting section matches the implementation
- `VENICE_NO_ANIMATION=1` is documented only if implemented

If a README claim conflicts with code or live help, code/help wins unless the code itself is being intentionally corrected as part of this task.

## Implementation quality requirements

### Performance

The greeting should add effectively zero steady-state overhead:

- no network calls
- no file reads on every render
- no continuous timer
- no expensive SVG/PNG processing
- no child process spawned solely for the greeting

The existing Git-branch lookup should not be duplicated.

### Accessibility and terminal compatibility

- readable with `NO_COLOR=1`
- readable on light and dark terminal themes
- no information conveyed by color alone
- no essential emoji
- stable with common terminal widths
- no hidden control characters in ASCII strings
- no cursor positioning escape hacks
- no output corruption when stdout is piped
- noninteractive modes remain clean and scriptable

### Security

This is UI work. It must not change:

- API-key storage
- permission policy
- tool risk classification
- shell approval flow
- session scoping
- workspace boundaries
- network approval semantics
- E2EE/TEE behavior
- MCP trust boundaries
- subagent tool boundaries

If any of those files change unexpectedly, stop and justify the change before proceeding.

## Validation sequence

Run the narrowest tests first, then the full repository gates.

```bash
set -euo pipefail
cd "/Users/super_user/Projects/venice-cli"

# Formatting/whitespace sanity
git diff --check

# Compile first
npm run build

# Lint
npm run lint

# Main compiled test suite
npm run test:compiled

# Security tests
npm run test:security

# Shell completion contract
npm run completions:check

# API drift/contract check
npm run api:contract

# Package contents
npm run pack:check
```

Then run the full gate:

```bash
npm run verify
```

`npm run verify` may include network-sensitive operations such as audit or API drift checks. If an external dependency/network failure prevents a gate from completing, report the exact command, exit code, and error; do not convert an environmental failure into a claimed pass.

## Manual terminal validation

Run a real interactive session after automated tests.

```bash
cd "/Users/super_user/Projects/venice-cli"
npm run dev -- agent
```

Check by resizing the terminal through these approximate widths:

```text
120 columns
80 columns
60 columns
40 columns
```

Verify:

- no wrap corruption
- no clipped composer/status bar
- model name is current
- branch/workspace are correct
- animation runs once and stops
- opening `/model` does not overlap the greeting
- entering the first user message dismisses the greeting cleanly
- Ctrl+C behavior is unchanged
- Ctrl+X behavior is unchanged
- model switching is unchanged
- session resume does not replay the greeting as transcript content

Opt-out checks:

```bash
VENICE_NO_ANIMATION=1 npm run dev -- agent
NO_COLOR=1 VENICE_NO_ANIMATION=1 npm run dev -- agent
TERM=dumb VENICE_NO_ANIMATION=1 npm run dev -- agent
```

Do not rely on screenshots alone. Inspect the actual text output and interaction behavior.

## Suggested changed-file scope

A clean implementation should usually fit within:

```text
README.md
src/ui/app.tsx
src/ui/app.test.tsx
src/ui/greeting.tsx
src/ui/greeting.test.tsx
```

Possibly:

```text
src/ui/brand.ts
src/ui/status.tsx          # only if extracting a reusable display helper is genuinely cleaner
```

And selected assets under:

```text
docs/assets/venice-cli-brand-refresh/brand/logos/...
```

Large unrelated diffs are a warning sign.

## Acceptance criteria

The task is complete only when all of the following are true:

- [ ] New blank interactive agent sessions display a Venice greeting.
- [ ] The greeting includes a compact ASCII crossed-keys interpretation.
- [ ] The greeting header says `Venice CLI`.
- [ ] The greeting includes `Private and uncensored AI.`.
- [ ] The greeting displays the actual active model.
- [ ] The greeting displays meaningful agent/permission mode context.
- [ ] Full-size greeting includes workspace/branch context when available.
- [ ] Greeting adapts to narrow/short terminals.
- [ ] Animation runs briefly and terminates.
- [ ] Animation is disabled on non-TTY/CI/`TERM=dumb`/`VENICE_NO_ANIMATION=1` paths.
- [ ] No animation timer leaks after completion or unmount.
- [ ] No greeting content is added to transcript/session/model context.
- [ ] Non-interactive/scripted command output is unaffected.
- [ ] `NO_COLOR` remains functional.
- [ ] Model picker, session picker, approvals, composer, status bar, Ctrl+C, and Ctrl+X remain functional.
- [ ] README uses approved Venice image assets.
- [ ] README paths resolve from the repository root.
- [ ] README installation/clone URLs target this fork and package scope.
- [ ] README command examples match the current CLI.
- [ ] Tests cover greeting content, responsive policy, and animation policy.
- [ ] `git diff --check` passes.
- [ ] Build, lint, compiled tests, and security tests pass.
- [ ] Full `npm run verify` passes, or any environment-only blocker is documented precisely.

## Do not rules

Do not:

- blindly overwrite current work without inspecting `git status`
- use the upstream `veniceai/venice-cli` clone URL in the finished README for this fork
- hardcode `kimi-k2-5` as the greeting's runtime model
- fetch the model catalog only to render the greeting
- add a new dependency for a four-frame animation unless existing primitives truly cannot support it
- use `console.log`, raw `stdout.write`, cursor-motion escapes, or screen-clearing hacks inside Ink
- run an infinite animation loop
- animate in CI or piped output
- put the greeting into transcript/session history
- send greeting text to the model
- weaken permission or security controls for visual polish
- distort or recolor the official PNG/SVG logo assets
- use Venetian Blue as the official logo color
- commit executive headshots or the full guideline PDF without an explicit reason
- claim a validation pass that was not executed successfully
- leave temporary backups or generated package tarballs tracked

## Final report format

When finished, report:

1. exact files changed
2. greeting behavior and responsive breakpoints
3. animation/opt-out behavior
4. README/asset integration decisions
5. asset files committed versus kept local only
6. commands executed
7. pass/fail result for each validation command
8. any residual risk or intentionally deferred work
9. final `git status --short`

Keep the report evidence-driven. Do not summarize a failed check as “mostly passing.”
