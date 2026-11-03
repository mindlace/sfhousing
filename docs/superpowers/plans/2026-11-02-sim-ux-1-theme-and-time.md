# /sim UX, plan 1 of 5: theme tokens, notice pills, sim-game time controls — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `/sim` the surface tokens every later plan styles with, move every notice into a stack of pills that never moves the layout on desktop, and replace the scrubber's Play/speed dropdown with Pause · Play · Faster plus Today and horizon markers, where scrubbing back to Today returns to Set Policy.

**Architecture:** New light and dark surface tokens join the `@theme` block in `src/routes/layout.css`; components use them as `bg-surface dark:bg-surface-dark` (Tailwind's `dark:` follows `prefers-color-scheme`). `FzpMode` renders its notices in a new `NoticePills` container at the top of the map; their height leaves `--fzp-scrubber-h`, the map inset and `--fzp-dock-top`. `TimeScrubber` gets three transport buttons and two end markers, and reports a user jump that lands on `asOf` through `ontoday`; `FzpMode` forwards it as `onrewind`, and `SimPage` resets the run.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, TypeScript, Tailwind 4, Vitest (server and client projects), Playwright, culori (already a dev dependency, used by `accent.spec.ts`).

**Spec:** `docs/superpowers/specs/2026-11-02-sim-ux-design.md` (Goals 7, 8, 9; Constraints). Plans 2 to 5 build on this one: 2 the dock, 3 the shared Paint tab on `/sim`, 4 the Transit tab and map selection, 5 `/` on the dock.

## Global Constraints

- SvelteKit 2, Svelte 5 runes, Tailwind 4. `md` (768 px) is the desktop/phone breakpoint.
- Header actions go through `useHeaderActions`; the save state stays in the header's status slot.
- CSP unchanged; no new runtime dependencies.
- Saved and shared policies open unchanged: this work is UI only.
- Every surface in this work follows `prefers-color-scheme`. Colours come from the `@theme` tokens in `src/routes/layout.css`. Dark surfaces use `accent-dark` (`#e0955a`) with `on-accent-dark`; light surfaces use `accent` (`#a3472c`). Both themes meet WCAG 2.2 AA (`docs/dev/accessibility.md`).
- Anti-goal "Layout that jumps": a notice, a recompute or a hover never moves the dock, the time bar or the map's insets (desktop). On phones notices sit in flow under the header and push content down (spec Goal 8).
- Time controls: `⏸ Pause · ▶ Play · ▶▶ Faster`, the current year, the track; no speed dropdown. ▶ is 1 year/s, ▶▶ is 3 years/s; the 1 month/s speed goes. In Set Policy the track and markers are disabled and ▶ reads **Run**. Scrubbing back to Today (a drag released at Today, the Today marker, Home) returns to Set Policy; a drag returns on release, not when it crosses Today; Replay at the horizon restarts the run and does not return.
- Vitest runs with `expect.requireAssertions`: every test calls `expect`. Colocated tests. Playwright e2e for flows.
- 2-space indent, single quotes, no trailing commas, 100 columns. Conventional Commits, committed with `-m` flags (never a heredoc). Never `cd x && cmd`. No Claude attribution anywhere (no `Co-Authored-By`, no "Generated with").

## Review Focus

1. **Replay at the horizon** sets the day to `asOf` and plays (`TimeScrubber.svelte:157-159`). Expected: the run restarts and stays in Run; `ontoday` does not fire. Test in Task 3.
2. **A drag that crosses Today and is released later**, or one released exactly at Today. Expected: the first stays in Run; the second returns to Set Policy once, on release. Test in Task 3.
3. **A notice appearing on desktop while the docked policy panel is open.** Expected: the panel's box, the scrubber's box and the map's bottom inset do not change. Test in Task 2 (component and e2e).
4. **Several notices at once** (the lever progress, "Some map data didn't load" with Retry, a session toast, a failed revision). Expected: they stack top centre, all readable and operable, none covering the header. Test in Task 2.
5. **`/lesscars`**, which shares `TimeScrubber` without `setup` or `ontoday` (`src/lib/lesscars/LessCarsMode.svelte:394-405`). Expected: Pause, Play and Faster work, its start marker shows its own start date, and nothing calls a phase change. Test in Task 3.

---

## File Structure

| File | Responsibility | Tasks |
| --- | --- | --- |
| `src/routes/layout.css` | surface, line and ink tokens, light and dark | 1 |
| `src/lib/shell/accent.spec.ts` | token contrast pairs; scans for hex and `bg-white` in themed files | 1, 2 |
| `src/lib/shell/pill.ts` (new) | the pill class strings shared by every notice | 2 |
| `src/lib/shell/NoticePills.svelte` (new, + spec) | the notice stack: overlay top centre from md, in flow below | 2 |
| `src/lib/fzp/FzpMode.svelte` | notices into `NoticePills`; inset and layout variables without them; `onrewind` | 2, 4 |
| `src/lib/sim-page/SimNotices.svelte` | pill styling | 2 |
| `src/lib/fzp/playback.ts`, `src/lib/fzp/types.ts` | two speeds, their names | 3 |
| `src/lib/fzp/TimeScrubber.svelte` (+ spec, `TimeScrubberHarness.svelte`) | Pause · Play · Faster, end markers, `ontoday`, tokens | 1, 3 |
| `src/lib/fzp/debug.ts` | `speed` in the hook | 3 |
| `src/lib/lesscars/LessCarsMode.svelte` | the scrubber's new props (start label) | 3 |
| `src/lib/sim-page/SimPage.svelte` | `onrewind` → `resetRun` | 4 |
| `e2e/helpers/run.ts`, `e2e/fzp.spec.ts`, `e2e/sim.spec.ts`, `e2e/chrome-dark.spec.ts` | the new path to a paused run; pills; dark scrubber | 2, 3, 4 |
| `docs/dev/fzp-mode.md`, `docs/dev/sim-page.md` | scrubber contract, layout variables, notices | 2, 3, 4 |

---

### Task 1: Surface tokens and the token spec

**Files:**
- Modify: `src/routes/layout.css:3-13`
- Modify: `src/lib/shell/accent.spec.ts:14-61`
- Modify: `src/lib/fzp/TimeScrubber.svelte:246-339` (the `<style>` block only)

**Interfaces:**
- Consumes: the existing tokens (`accent`, `accent-hover`, `on-accent`, `accent-tint`, `accent-dark`, `accent-dark-hover`, `on-accent-dark`, `chrome-dark`, `chrome-dark-raised`).
- Produces (Tailwind colours, so `bg-surface`, `text-ink-dark-muted`, `border-line-dark` …; and CSS variables `--color-*` on `:root`):

  | Token | Light | Token | Dark |
  | --- | --- | --- | --- |
  | `surface` | `#ffffff` | `surface-dark` | `#1c1d1f` |
  | `surface-raised` | `#f3f4f6` | `surface-dark-raised` | `#2c2e31` |
  | `line` | `#d1d5db` | `line-dark` | `#3b3d41` |
  | `control-line` | `#64748b` | `control-line-dark` | `#8f8a80` |
  | `ink` | `#111827` | `ink-dark` | `#e8e4dc` |
  | `ink-muted` | `#4b5563` | `ink-dark-muted` | `#b4aea3` |

  Every later plan styles a themed surface as `bg-surface text-ink dark:bg-surface-dark dark:text-ink-dark` (raised controls `bg-surface-raised dark:bg-surface-dark-raised`), selected and primary controls as `bg-accent text-on-accent dark:bg-accent-dark dark:text-on-accent-dark`. Values are plain hex, so the spec's token regex (`accent.spec.ts:10`) reads them.

- [ ] **Step 1: Write the failing tests**

In `accent.spec.ts`, replace the test `'light-only surfaces use the light accent: no colour token is redefined under dark'` (line 50-52; the spec reverses that ruling) with:

```ts
it('text tokens are >= 4.5:1 on every surface of their theme', () => {
  for (const bg of ['surface', 'surface-raised'])
    for (const fg of ['ink', 'ink-muted'])
      expect(contrast(tok[fg], tok[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  for (const bg of ['surface-dark', 'surface-dark-raised'])
    for (const fg of ['ink-dark', 'ink-dark-muted', 'accent-dark'])
      expect(contrast(tok[fg], tok[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  expect(contrast(tok['accent'], tok['surface-raised'])).toBeGreaterThanOrEqual(4.5);
});
it('control borders are >= 3:1 on their surfaces (WCAG 1.4.11)', () => {
  for (const bg of ['surface', 'surface-raised'])
    expect(contrast(tok['control-line'], tok[bg])).toBeGreaterThanOrEqual(3);
  for (const bg of ['surface-dark', 'surface-dark-raised'])
    expect(contrast(tok['control-line-dark'], tok[bg])).toBeGreaterThanOrEqual(3);
});
it('the time bar uses tokens, not hex', () => {
  const src = readFileSync(fromRoot('src/lib/fzp/TimeScrubber.svelte'), 'utf8');
  expect(src).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
});
```

Also add `expect(tok['surface-dark']).toBe(tok['chrome-dark'])` to `'declares the accent tokens'`, so the dock and the header share one dark.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/shell/accent.spec.ts`
Expected: FAIL (`tok['ink']` undefined; TimeScrubber has hex literals).

- [ ] **Step 3: Add the tokens and move TimeScrubber's style onto them**

`layout.css`: the twelve tokens above inside `@theme`. `TimeScrubber.svelte`'s `<style>`: every colour becomes `var(--color-…)` (bar `surface`/`surface-dark`, border `line`/`line-dark`, `.ctl` border `control-line`/`control-line-dark` and background `surface`/`surface-dark-raised`, hover `surface-raised`/`chrome-dark-raised`, accent and focus outline `accent`/`accent-dark`, `.run` `accent`, `on-accent`, `accent-hover` and their dark counterparts). Keep the `@media (prefers-color-scheme: dark)` block, now swapping variables only.

- [ ] **Step 4: Run the tests**

Run: `npx vitest --run --project server src/lib/shell/accent.spec.ts` and `npx vitest --run --project client src/lib/fzp/TimeScrubber.svelte.spec.ts`
Expected: PASS (the scrubber's behaviour tests are unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/routes/layout.css src/lib/shell/accent.spec.ts src/lib/fzp/TimeScrubber.svelte
git commit -m "feat(theme): light and dark surface tokens; the time bar uses them"
```

---

### Task 2: Notices as pills that never move the layout

Today the ready-phase notices sit above the scrubber and their height (`noticeH`) feeds `--fzp-scrubber-h`, the map inset and `--fzp-dock-top` (`FzpMode.svelte:570-594, 875, 952-1033`), so the docked panel (`PolicyPanel.svelte:242`, `bottom: var(--fzp-scrubber-h)`) moves up when one shows. The loading, failed and no-scenario notices are separate top boxes (`FzpMode.svelte:893-934`).

**Files:**
- Create: `src/lib/shell/pill.ts`, `src/lib/shell/NoticePills.svelte`, `src/lib/shell/NoticePills.svelte.spec.ts`
- Modify: `src/lib/fzp/FzpMode.svelte:236-238, 570-594, 872-1056`, `src/lib/fzp/FzpMode.svelte.spec.ts`
- Modify: `src/lib/sim-page/SimNotices.svelte` (classes only)
- Modify: `src/lib/shell/accent.spec.ts` (add the two files to a `THEMED_FILES` scan)
- Modify: `e2e/sim.spec.ts`, `e2e/fzp.spec.ts` (notice placement assertions)
- Modify: `docs/dev/fzp-mode.md` ("Layout variables", the notices paragraph), `docs/dev/sim-page.md` ("Notices" bullet)

**Interfaces:**
- Consumes: Task 1's tokens.
- Produces:
  ```ts
  // src/lib/shell/pill.ts
  /** One notice: a rounded-full line on a themed surface, with a shadow; text-sm. */
  export const PILL: string;
  /** A pill's action button (Retry, Details, ×): min 44 px target, underlined, semibold. */
  export const PILL_ACTION: string;
  ```
  `NoticePills.svelte`: `{ children: Snippet }`. Renders `<div data-testid="fzp-notices" class="sfh-notice-pills …">` around `children`, a column of pills centred, `gap-1`. From md: `absolute top-2 z-30`, centred over the map right of the docked panel (`left: calc(50% + var(--sim-panel-w, 0px) / 2)`, `-translate-x-1/2`, `max-width: calc(100% - 2rem - var(--sim-panel-w, 0px))`), `pointer-events-none` with `pointer-events-auto` pills. Below md: static, in flow, full width, `px-4 py-1`.
  FzpMode's root becomes a flex column: `NoticePills` first, then `<div class="relative min-h-0 flex-1">` holding SimMap and everything that was absolutely positioned inside `.sfh-fzp` (card, tooltip, scrubber, panel, dialog). `--fzp-scrubber-h` is `scrubberH` px; `applyInset()` sets `scrubberH`; `publishDockTop()` subtracts `scrubberH` only. `noticeH` is deleted.

- [ ] **Step 1: Write the failing tests**

`NoticePills.svelte.spec.ts` (client): renders two children pills; at 1024 px the container's computed `position` is `absolute`; at 375 px it is `static`; the container has `data-testid="fzp-notices"`.

`FzpMode.svelte.spec.ts`: replace the tests that read `noticeH` into the inset with:

```ts
it('a lever notice shows at the top and changes neither --fzp-scrubber-h nor the map inset', async () => {
  const { w, map } = await readyFzp({ levers: someLevers }); // existing host helpers
  const root = document.querySelector<HTMLElement>('.sfh-fzp')!;
  const before = root.style.getPropertyValue('--fzp-scrubber-h');
  const insets = map.bottomInsets.length;
  w.emit({ type: 'levers', rev: w.lastOf('initScenario')!.rev, phase: 'resolving', done: 1, total: 9, failedCells: ['c1'] });
  await expect.element(page.getByText(/Updating the simulation for your policy/)).toBeVisible();
  const pills = page.getByTestId('fzp-notices');
  await expect.element(pills.getByRole('button', { name: 'Retry' })).toBeVisible();
  expect(root.style.getPropertyValue('--fzp-scrubber-h')).toBe(before);
  expect(map.bottomInsets.length).toBe(insets);
});
it('the loading, failed and no-scenario notices render in the same stack', async () => { /* each phase: getByTestId('fzp-status') is inside getByTestId('fzp-notices') */ });
```

(`readyFzp`, `someLevers` and `map.bottomInsets` stand for the spec's existing host and stub helpers in `src/lib/fzp/test/`; use what is there, adding a `bottomInsets` record to `sim-map-stub.ts` if it has none.)

In `accent.spec.ts`, add `THEMED_FILES = ['src/lib/shell/NoticePills.svelte', 'src/lib/sim-page/SimNotices.svelte', 'src/lib/fzp/FzpMode.svelte']` and a test that none contains `bg-white` or `text-black` (later plans append their files to this list).

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project client src/lib/shell/NoticePills.svelte.spec.ts src/lib/fzp/FzpMode.svelte.spec.ts` and `npx vitest --run --project server src/lib/shell/accent.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `pill.ts`: `PILL = 'pointer-events-auto flex w-max max-w-full items-center gap-1 rounded-full border border-line bg-surface py-1 pl-4 pr-1 text-sm text-ink shadow dark:border-line-dark dark:bg-surface-dark-raised dark:text-ink-dark'` (a pill with no action pads `pr-4`); `PILL_ACTION = 'min-h-11 min-w-11 rounded-full px-3 font-semibold underline'`.
- `NoticePills.svelte` as in Interfaces.
- `FzpMode.svelte`: every notice (loading, failed with Retry, no-scenario with its link, the page's `notices` snippet, stopped with Retry, "Making another future…", the lever progress and its "Some map data didn't load." Retry, the failed revision alert, the reroll alert with ×) renders inside `NoticePills`, in that order, each with `PILL`. Keep every `role`, `data-testid` (`fzp-status`, `fzp-lever-status`, `fzp-lever-failed`) and the always-rendered empty alert region on `/sim` (`FzpMode.svelte:1001-1018`). The no-scenario notice keeps its two lines in a `rounded-lg` variant of the pill (builder's call: a sentence and a link do not fit one line at 375 px).
- `SimNotices.svelte`: its items use `PILL` and `PILL_ACTION`; the live-region rules are unchanged.

- [ ] **Step 4: Run the tests**

Run: the Step 2 commands, then `npx vitest --run --project client src/lib/sim-page`
Expected: PASS.

- [ ] **Step 5: e2e**

In `e2e/sim.spec.ts` add:

```ts
test('a notice never moves the docked panel or the time bar', async ({ page, isMobile }) => {
  test.skip(isMobile, 'desktop rule; phones push content down by design');
  await gotoSim(page);
  const panelBox = await panel(page).boundingBox();
  const barBox = await page.getByTestId('fzp-scrubber').boundingBox();
  await addTransitRule(page); // existing helper: sends a revision, so "Updating…" shows
  await expect(page.getByTestId('fzp-lever-status')).toContainText('Updating the simulation');
  expect(await panel(page).boundingBox()).toEqual(panelBox);
  expect(await page.getByTestId('fzp-scrubber').boundingBox()).toEqual(barBox);
});
```

and at 375 px: while a notice shows, `fzp-notices`'s box top equals the header's bottom and the map root (`[data-testid=map-root]`) starts below it. Update any assertion that the notices sit above the scrubber.

Run: `SFH_E2E_PORT=4206 SFH_E2E_WORKERS=1 npx playwright test e2e/sim.spec.ts e2e/fzp.spec.ts`
Expected: PASS on `chromium` and `mobile`.

- [ ] **Step 6: Docs and commit**

`fzp-mode.md`: `--fzp-scrubber-h` is the scrubber's height only; `--fzp-dock-top` is the scrubber's top edge; the notices are a pill stack at the top (overlay from md, in flow below md). `sim-page.md`: SimNotices render in the pill stack.

```bash
git add src/lib/shell src/lib/fzp src/lib/sim-page/SimNotices.svelte e2e docs/dev
git commit -m "feat(sim): notices are pills at the top of the map and never move the layout"
```

---

### Task 3: Pause · Play · Faster, end markers and `ontoday`

**Files:**
- Modify: `src/lib/fzp/playback.ts`, `src/lib/fzp/types.ts:7-8`, `src/lib/fzp/playback.spec.ts`
- Modify: `src/lib/fzp/TimeScrubber.svelte:16-244`, `TimeScrubber.svelte.spec.ts`, `TimeScrubberHarness.svelte`
- Modify: `src/lib/fzp/debug.ts` (add `speed`), `src/lib/fzp/FzpMode.svelte:795-811` (report it)
- Modify: `src/lib/lesscars/LessCarsMode.svelte:394-405` (no change needed beyond type-checking; `startLabel` defaults to the date)
- Modify: `src/lib/shell/accent.spec.ts` (`SCANNED` keeps `TimeScrubber.svelte`)
- Modify: `docs/dev/fzp-mode.md` ("The scrubber contract", "Speeds")

**Interfaces:**
- Consumes: `formatMonthYear`, `formatShortMonthYear` (`src/lib/fzp/format.ts:30,40`), `utcParts` (`time.ts`).
- Produces:
  ```ts
  // types.ts
  export type Speed = 'year' | 'threeYears';
  // playback.ts
  export const SPEED_DAYS: Record<Speed, number>; // year: 12 × MONTH_DAYS, threeYears: 36 × MONTH_DAYS
  export const DEFAULT_SPEED: Speed; // 'year'
  export const SPEED_NAME: Record<Speed, string>; // '1 year per second', '3 years per second'
  // SPEED_LABEL is removed; advance() is unchanged.
  ```
  `TimeScrubber` props (new or changed; the rest unchanged):
  ```ts
  /** The start marker's visible text (default `formatShortMonthYear(asOf)`; /sim passes 'Today'). */
  startLabel?: string;
  /**
   * A user jump landed on `asOf` outside setup: Home, the start marker, an arrow or Page key
   * clamped to it, or a drag released there (the range's `change`). Not Replay, not a drag
   * passing through, not a programmatic `day` change.
   */
  ontoday?: () => void;
  ```
  Controls, left to right: Pause (`data-testid="fzp-pause"`, name "Pause"), Play (`fzp-play`, its stacked labels Run, Play, Replay with `fzp-play-label`; name "Run" in setup, else "Play" or "Replay"), Faster (`fzp-faster`, name "Faster", `title` `SPEED_NAME.threeYears`), the readout (`fzp-readout`, unchanged), then the track row: the start marker button (`fzp-start`, text `startLabel`, name `Jump to ${startLabel}, ${formatMonthYear(asOf)}`), the range, the end marker button (`fzp-end`, text the horizon year, name `Jump to ${year}`), and the marker row under the range (RHNA deadline, 2045: `scrubMarkers`, unchanged). Glyphs ⏸ ▶ ▶▶ are `aria-hidden` inline SVG or text (builder's call on treatment). Play and Faster carry `aria-pressed={playing && speed === …}`.
  Behaviour: Pause sets `playing = false`. Play: in setup calls `onrun`; at the end (Replay) `setDay(asOf)` and plays at `'year'`; else sets `speed = 'year'` and plays. Faster: sets `speed = 'threeYears'` and plays (at the end it restarts like Replay). In setup, Pause and Faster are `invisible` (they keep their space, so the bar does not shift, and leave the tab order), Play reads Run, and the range and all markers are `disabled`.
  `debug.ts`: `readonly speed: Speed`.

- [ ] **Step 1: Write the failing tests**

`playback.spec.ts`: `SPEED_DAYS` has exactly the keys `year` and `threeYears`; `advance(0, 1000, 'threeYears', 10_000).day` is `36 * MONTH_DAYS` (floored).

`TimeScrubber.svelte.spec.ts` (through `TimeScrubberHarness`, which gains `ontoday` and `startLabel` pass-through and a `todayCalls` counter):

```ts
it('Play plays at 1 year/s, Faster at 3 years/s, Pause stops', async () => { /* aria-pressed and the bound speed after each press */ });
it('there is no speed select', async () => {
  expect(page.getByRole('combobox').elements()).toHaveLength(0);
});
it('in setup Play reads Run, Pause and Faster are hidden, the track and markers are disabled', async () => {});
it('Home, the start marker and an arrow clamped to asOf call ontoday once each', async () => {});
it('a drag released at asOf calls ontoday; input events at asOf mid-drag do not', async () => {
  const r = range();
  r.value = String(ASOF); r.dispatchEvent(new Event('input', { bubbles: true }));
  expect(h.todayCalls).toBe(0);
  r.dispatchEvent(new Event('change', { bubbles: true }));
  expect(h.todayCalls).toBe(1);
});
it('a drag released after asOf does not call ontoday', async () => {});
it('Replay at the horizon restarts from asOf without calling ontoday', async () => {
  // day = HORIZON, playing false → press Play (reads Replay) → day asOf, playing true, todayCalls 0
});
it('the start marker shows startLabel; the end marker the horizon year', async () => {});
it('in setup ontoday never fires', async () => {});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project server src/lib/fzp/playback.spec.ts` and `npx vitest --run --project client src/lib/fzp/TimeScrubber.svelte.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`playback.ts` and `types.ts` as in Interfaces. `TimeScrubber.svelte`: replace the toggle (`:152-163`) with `pause()`, `play(s: Speed)`; `jump(to, user = true)` calls `ontoday` when `user && !setup && to === asOf`; the range's `oninput` jumps with `user = false` and a new `onchange` checks `Number(value) === asOf`; Replay uses `setDay(asOf)` directly (not `jump`). Remove the select and its label. `FzpMode` and `LessCarsMode` compile unchanged apart from the `Speed` type; FzpMode adds `speed` to `installFzpDebug`.

- [ ] **Step 4: Run the tests**

Run: the Step 2 commands, then `npm run check`
Expected: PASS; 0 errors (`LessCarsMode` and the bench files type-check with the narrower `Speed`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/fzp src/lib/lesscars/LessCarsMode.svelte src/lib/shell/accent.spec.ts docs/dev/fzp-mode.md
git commit -m "feat(sim): sim-game time controls with Today and horizon markers"
```

---

### Task 4: Scrubbing back to Today returns to Set Policy

**Files:**
- Modify: `src/lib/fzp/FzpMode.svelte:108-177` (prop), `:1034-1051` (wiring), `FzpMode.svelte.spec.ts`
- Modify: `src/lib/sim-page/SimPage.svelte:404-407, 908-948`, `SimPage.svelte.spec.ts`
- Modify: `e2e/helpers/run.ts`, `e2e/fzp.spec.ts:247-300,447`, `e2e/sim.spec.ts` (every `run: true` user and the Run/Change policy tests)
- Modify: `e2e/chrome-dark.spec.ts` (axe on the scrubber in Run and Setup)
- Modify: `docs/dev/fzp-mode.md` ("Run phase"), `docs/dev/sim-page.md` ("Setup and Run", "e2e")

**Interfaces:**
- Consumes: Task 3's `ontoday`, `startLabel`.
- Produces: FzpMode prop `onrewind?: () => void` — called from the scrubber's `ontoday` while `runPhase === 'run'`; FzpMode also passes `startLabel="Today"` when `runPhase` is given. SimPage passes `onrewind={resetRun}` (`resetRun` unchanged: unlocks the store, `run.reset()`; FzpMode's Setup effect pins the day and stops playback, `FzpMode.svelte:538-551`).
  `e2e/helpers/run.ts`: `startRun(page)` presses Run, waits for `__sfhFzp.playing`, presses Pause, and waits for `runPhase === 'run' && !playing`. The day is then just past `asOf` (or `asOf` if paused before the first frame), and the run stays in Run, because only a user jump to Today returns. Tests that pressed Home to sit at `asOf` inside a run now read the day from the hook instead, or jump with a marker.

- [ ] **Step 1: Write the failing tests**

`FzpMode.svelte.spec.ts`: with `runPhase: 'run'` and an `onrewind` spy, pressing the start marker calls it once; with `runPhase: 'setup'` the marker is disabled and the spy is not called; without `runPhase` (bare) the start marker reads the date, not "Today".

`SimPage.svelte.spec.ts`:

```ts
it('Home on the slider during a run returns to Setup and unlocks the policy', async () => {
  const { w } = await readySim();
  await pressRun(w); // existing helpers: Run, then the timeline for the latest rev
  await expect.poll(() => fzpDebug().playing).toBe(true);
  slider().focus();
  await userEvent.keyboard('{Home}');
  await expect.poll(() => fzpDebug().runPhase).toBe('setup');
  expect(fzpDebug().playing).toBe(false);
  expect(store().locked).toBe(false);
});
```

e2e (`e2e/sim.spec.ts`): "the Today marker in a run returns to Setup; Replay at the horizon does not": start a run, press End, wait `playing === false`, press Replay (`fzp-play`), expect `runPhase` stays `'run'` and `playing` true; press Pause, press the Today marker, expect `runPhase === 'setup'` and the Run label.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest --run --project client src/lib/fzp/FzpMode.svelte.spec.ts src/lib/sim-page/SimPage.svelte.spec.ts`
Expected: FAIL (`onrewind` unknown).

- [ ] **Step 3: Implement**

FzpMode: the prop, `ontoday={() => runPhase === 'run' && onrewind?.()}` and `startLabel={runPhase ? 'Today' : undefined}` on `TimeScrubber`. SimPage: `onrewind={resetRun}`. `e2e/helpers/run.ts` as in Interfaces; then fix each spec that used `run: true` and Home (`e2e/fzp.spec.ts:260` and the others the grep `run: true` lists): replace "Home to asOf" with reading `__sfhFzp.day` or pressing a marker.

- [ ] **Step 4: Run the tests**

Run: the Step 2 command, then `SFH_E2E_PORT=4206 SFH_E2E_WORKERS=1 npx playwright test e2e/sim.spec.ts e2e/fzp.spec.ts e2e/fzp-sim.spec.ts e2e/chrome-dark.spec.ts e2e/lesscars.spec.ts`
Expected: PASS on `chromium` and `mobile`.

- [ ] **Step 5: Lint, docs and commit**

Run: `npm run lint` and `npm run check`. Expected: clean.

```bash
git add src/lib/fzp src/lib/sim-page/SimPage.svelte src/lib/sim-page/SimPage.svelte.spec.ts e2e docs/dev
git commit -m "feat(sim): scrubbing back to Today returns to Set Policy"
```

---

## Open questions

None for this plan. Builder's calls made here: Pause and Faster are `invisible` in Set Policy (they keep their space so the bar never shifts; the spec's "one primary action"); the Today and horizon markers are the track's end labels turned into buttons (a marker at 0 % or 100 % would overhang the track); an arrow or Page key that clamps to `asOf` counts as scrubbing back to Today, like Home.
