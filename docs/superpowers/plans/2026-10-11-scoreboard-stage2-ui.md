# Scoreboard Stage 2 (UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Stage 2 of 2.** Stage 1 (the pure core: `types.ts`, `targets.ts`, `accumulator.ts`, `format.ts`) is merged on the integration branch. This plan builds everything else in the spec: the UI (§4.4), the copy (§4.6), accessibility (§4.7), the page wiring, and the client and e2e tests (§6).

**Goal:** Ship the `Scoreboard` UI: the desktop panel, the 375 px bar and bottom sheet, every §4.4 state, and the aria-live announcement. Wire it into `/` through a conductor-approved additive surface on `BrushEditor`.

**Architecture:**
- Pure view logic goes in `src/lib/scoreboard/view.ts`, unit-tested in the server project.
- Presentational Svelte 5 components: `TargetRow`, `NeighborhoodList`, `ScoreboardPanel`, and the top-level `Scoreboard`, which owns layout, the sheet and the live region.
- `frameLatest` (`latest.svelte.ts`) commits the latest score to reactive state at most once per animation frame.
- The page (`src/routes/+page.svelte`) holds `bind:this` on `BrushEditor` and connects its four new members to `Scoreboard`. Those members are `onscore(s, { complete })` (a second argument), `onchunks`, `retryChunks()` and `setSheetInset()`, added additively in Task 4.

**Tech Stack:** Svelte 5 runes, Tailwind 4, Vitest 4 (the server project, plus the client project in Chromium via `vitest-browser-svelte`), Playwright with `@axe-core/playwright` (`e2e/helpers/a11y.ts`).

**Spec:** `docs/superpowers/specs/2026-10-10-scoreboard-design.md` (design: `docs/superpowers/design/2026-10-10-1749-sf-housing-sim.md`; consumer surface: `docs/superpowers/specs/2026-10-10-brush-tool-design.md` line 148, §4.9)

## Global Constraints

Copied verbatim from spec §3:

- **Free and open source.** No paid APIs and no vendor keys are needed to run or build it. Licence: MIT for code (OD-3). Data attribution is shown in-app (ODbL for the OSM/Protomaps basemap and Overture, PDDL/public domain for DataSF).
- **Determinism.** The same `Plan` + `datasetVersion` gives the same buildings and the same score, on every machine.
- **Overshoot is meaningful.** No readout caps at 100% of a target.
- **Honesty of numbers.** Every unit count is labelled with what it is (M1: *theoretical max buildout*). Net counts are shown, not gross. Sources and vintages are visible.
- **Performance targets.** Existing-city view pans at 60 fps on a 2022-era laptop. Generated buildings appear within 150 ms of pointer-up for strokes covering ≤ 500 parcels. A whole-city repaint (≈150k parcels) finishes within 5 s, off the main thread. The first meaningful paint transfers ≤ 5 MB (parcel chunks load lazily under the brush).
- **Mobile works.** Touch painting uses an explicit mode switch. Layout works at 375 px.
- **Data is static and versioned.** The worker does no geo computation at runtime.
- **Cross-project conventions apply:** Conventional Commits, worktrees for all work, bare-name Cloudflare resources (`sfhousing`), and the migration workflow via Drizzle.

I11 (verbatim): `interface Score { grossUnits: number; demolishedUnits: number; netUnits: number; targets: TargetProgress[]; parcelsChanged: number; byNeighborhood: Record<string, number> }`; `interface Target { id: string; label: string; units: number; range?: [low: number, high: number]; source: { label: string; url: string } }`; `interface TargetProgress { target: Target; fraction: number /* uncapped: 1.8 = 180% */ }`. Marking: MC (net units against named targets; overshoot is meaningful).

Spec §4.4–§4.7 are binding for every task. The exact strings are listed in Task 1 (`view.ts`) and Task 2 (the §4.6 copy). Do not paraphrase them.

Relays from the conductor (binding):

- Match targets by `target.id`, never by object identity: scores arrive through structured clone. `byNeighborhood` keys arrive sorted and trimmed.
- CSP: zod runs jitless through `src/hooks.client.ts`. Never add `unsafe-eval` and never touch `kit.csp`.
- Map-view's chip is the single **on-map** Retry control. The scoreboard's warning row explains the effect on totals and also sends `retryChunks` (spec §4.4).
- If any typology name is rendered, use map-view's `typologyLabel(typology, units)` and do not fork it. This plan renders no typology names.
- e2e: kill any stale `:4173` server before running, because the e2e build sets `VITE_E2E=1`. An e2e test that needs plan-sharing (W5c) goes in as `test.fixme('W6: <reason>')`. Do not un-fixme map-view's W6 tests.
- BrushEditor additions follow the conductor's DC ruling:
  - They are purely additive.
  - Every existing brush test stays green and unmodified, with one exception: per the conductor's pick (B), `BrushEditor.svelte.spec.ts:138` is extended to `toHaveBeenCalledWith({ total: 1 }, { complete: true })`, and the commit body says so.
  - Each new member gets JSDoc in the style of `oneditor`/`getEditor`.
  - They land in their own `feat(brush): …` commit.

Project rules:

- Code style: 2-space indent, single quotes, no trailing commas, 100 columns.
- Every Vitest test calls `expect`.
- Server tests: `./node_modules/.bin/vitest --run --project server <path>`. Client tests: `./node_modules/.bin/vitest --run --project client <path>`.
- A fresh worktree needs `./node_modules/.bin/svelte-kit sync` first.
- Do not touch `src/lib/{data,plan,generator,map,sim}/`. The only file outside `src/lib/scoreboard` and `e2e/` that this plan touches is `src/lib/brush/BrushEditor.svelte` and its spec (Task 4), plus `src/routes/+page.svelte` (Task 5).
- WCAG 2.2 AA:
  - interactive targets ≥ 24×24 CSS px (`min-h-11` for touch buttons, matching brush);
  - no horizontal scroll at 375 px;
  - colour is never the only signal.

## Review Focus

1. **A score that arrives before the first diff, or never arrives** (worker still loading, or a manifest error). The UI renders the empty state from `score([], M1_TARGETS)` instead of crashing on `null` (Task 3 test).
2. **A burst of diffs within one frame** (whole-city repaint). Expected: at most one reactive update per animation frame, showing the latest value, with none dropped at the end (Task 3 `frameLatest` test).
3. **Sheet open, then the viewport widens past 768 px, or the scoreboard unmounts.** Expected: the inset returns to the computed value (`setSheetInset(null)`), and `--scorebar-h` stops applying once the scoreboard is gone (Task 3 and Task 5 tests).
4. **Live region chatter.** Expected: nothing is announced on first render or while updating; exactly one announcement 1 s after the last change once settled; no repeat when the value has not changed (Task 3 test).
5. **No manifest** (`manifestError`, so `builtAt` is unknown). Expected: the footnote omits the "built" part instead of printing "built " with nothing after it (Task 1 test).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/scoreboard/view.ts` | `ScoreStatus`, `BADGE`, pure helpers (track max, fills, remainder, rows, state, announcement, bar text, footnote) |
| `src/lib/scoreboard/view.spec.ts` | server tests for view.ts |
| `src/lib/scoreboard/latest.svelte.ts` | `frameLatest<T>`: rAF-coalesced reactive latest value |
| `src/lib/scoreboard/TargetRow.svelte` | one target: label, percent, meter bar with tick, remainder |
| `src/lib/scoreboard/NeighborhoodList.svelte` | sorted rows, top 10, "Show all {k}" |
| `src/lib/scoreboard/ScoreboardPanel.svelte` | the full panel content (§4.4 items 1–7 + states) |
| `src/lib/scoreboard/Scoreboard.svelte` | region, desktop dock, mobile bar + sheet, live region, `--scorebar-h` |
| `src/lib/scoreboard/ScoreboardPanel.svelte.spec.ts` | client tests: states, bars, list, copy, footnote |
| `src/lib/scoreboard/Scoreboard.svelte.spec.ts` | client tests: 375 bar/sheet, live region, frameLatest, sheet callback |
| `src/lib/scoreboard/index.ts` | append exports |
| `src/lib/brush/BrushEditor.svelte` (+ spec) | additive sibling surface (Task 4) |
| `src/routes/+page.svelte` | wiring (Task 5) |
| `e2e/scoreboard.spec.ts` | spec §6 e2e 1–5 |

---

### Task 1: Pure view helpers (`view.ts`)

**Files:**
- Create: `src/lib/scoreboard/view.ts`
- Modify: `src/lib/scoreboard/index.ts` (append exports)
- Test: `src/lib/scoreboard/view.spec.ts`

**Interfaces:**
- Consumes: `Score` and `TargetProgress` from `./types`; `formatCount`, `formatPercent`, `formatCompactCount` and `formatBuiltDate` from `./format`; `BuildoutMode` from `$lib/generator`; `score` from `./accumulator` and `M1_TARGETS` from `./targets` (tests only).
- Produces (later tasks rely on these exact names):
  - `export interface ScoreStatus { pendingChunks: number; failedChunks: number; complete: boolean; datasetVersion: string; builtAt: string; planDatasetVersion?: string; mode: BuildoutMode }`
  - `export const BADGE: Record<BuildoutMode, string>`, `export const PRIMARY_TARGET_ID = 'rhna'`, `export const NEIGHBORHOOD_TOP = 10`
  - `trackMax(targets: readonly TargetProgress[]): number`
  - `fillPercent(fraction: number, max: number): number`
  - `tickPercent(max: number): number`
  - `remainderText(netUnits: number, targetUnits: number): string`
  - `meterValueText(tp: TargetProgress): string`
  - `export interface NeighborhoodRow { name: string; net: number }` and `neighborhoodRows(by: Record<string, number>): NeighborhoodRow[]`
  - `export interface ViewState { empty: boolean; updating: boolean; failed: boolean; oldPlan: boolean }` and `viewState(score: Score, status: ScoreStatus): ViewState`
  - `primaryTarget(score: Score): TargetProgress | undefined`
  - `announcement(score: Score): string`
  - `barText(score: Score): string`
  - `secondaryText(score: Score): string`
  - `footnoteLead(status: ScoreStatus): string`
  - `oldPlanNote(status: ScoreStatus): string`

Note: spec §2 lists `ScoreStatus` without `complete`, yet §4.4 "updating" reads "the latest diff has `complete: false`". `complete` is added to this UI-only internal type. It is not an I-row.

- [ ] **Step 1: Write the failing test** `src/lib/scoreboard/view.spec.ts`

```ts
import { describe, expect, it } from 'vitest';
import { score } from './accumulator';
import { building, parcel } from './score-fixtures';
import { M1_TARGETS } from './targets';
import type { Score } from './types';
import {
  announcement,
  BADGE,
  barText,
  fillPercent,
  footnoteLead,
  meterValueText,
  neighborhoodRows,
  oldPlanNote,
  primaryTarget,
  remainderText,
  secondaryText,
  tickPercent,
  trackMax,
  viewState,
  type ScoreStatus
} from './view';

function withNet(net: number, hood = 'Mission'): Score {
  const p = parcel('9000001', 0, hood);
  return score(net > 0 ? [[p, building(p, net, true)]] : [], M1_TARGETS);
}

const status = (s: Partial<ScoreStatus> = {}): ScoreStatus => ({
  pendingChunks: 0,
  failedChunks: 0,
  complete: true,
  datasetVersion: '2026-10-10-abcdef12',
  builtAt: '2026-10-10T12:00:00Z',
  mode: 'max',
  ...s
});

describe('badge', () => {
  it('M1 max mode reads "Theoretical max buildout"', () => {
    expect(BADGE.max).toBe('Theoretical max buildout');
  });
});

describe('track and bars (§4.4 progress bar)', () => {
  it('track is max(1, ceil(maxFraction·2)/2) over all targets', () => {
    expect(trackMax(withNet(0).targets)).toBe(1);
    expect(trackMax(withNet(41035).targets)).toBe(1); // 0.5
    expect(trackMax(withNet(82069).targets)).toBe(1); // exactly 1
    expect(trackMax(withNet(82070).targets)).toBe(1.5);
    expect(trackMax(withNet(147724).targets)).toBe(2); // 1.8 → 2
    expect(trackMax(withNet(164138).targets)).toBe(2); // exactly 2.0
  });

  it('tick sits at 100% of target, fill at the fraction, never clamped', () => {
    expect(tickPercent(1)).toBe(100);
    expect(tickPercent(2)).toBe(50);
    expect(fillPercent(1.8, 2)).toBe(90);
    expect(fillPercent(1, 1)).toBe(100);
    expect(fillPercent(-0.1, 1)).toBe(0); // drawn from 0
  });

  it('remainder: under target "to go", at/over "over target"', () => {
    expect(remainderText(80000, 82069)).toBe('2,069 to go');
    expect(remainderText(82069, 82069)).toBe('0 over target');
    expect(remainderText(147724, 82069)).toBe('65,655 over target');
    expect(remainderText(-5, 82069)).toBe('82,074 to go');
  });

  it('meter valuetext is "{pct} of {label}"', () => {
    // 147725/82069 = 1.800009 (147724 would be 1.79999 → '179%')
    expect(meterValueText(withNet(147725).targets[0])).toBe('180% of RHNA 2023–2031');
  });
});

describe('neighborhoods', () => {
  it('sorts by net descending, ties by name (en)', () => {
    expect(neighborhoodRows({ Bayview: 5, Mission: 9, 'Noe Valley': 5, Excelsior: 12 })).toEqual([
      { name: 'Excelsior', net: 12 },
      { name: 'Mission', net: 9 },
      { name: 'Bayview', net: 5 },
      { name: 'Noe Valley', net: 5 }
    ]);
  });

  it('empty record → no rows', () => {
    expect(neighborhoodRows({})).toEqual([]);
  });
});

describe('viewState (§4.4 states)', () => {
  it('empty: no changed parcels and nothing pending', () => {
    expect(viewState(withNet(0), status())).toMatchObject({ empty: true, updating: false });
    expect(viewState(withNet(0), status({ pendingChunks: 2 })).empty).toBe(false);
    expect(viewState(withNet(3), status()).empty).toBe(false);
  });

  it('updating: chunks pending or latest diff incomplete', () => {
    expect(viewState(withNet(3), status({ pendingChunks: 1 })).updating).toBe(true);
    expect(viewState(withNet(3), status({ complete: false })).updating).toBe(true);
    expect(viewState(withNet(3), status()).updating).toBe(false);
  });

  it('failed: any failed chunk', () => {
    expect(viewState(withNet(3), status({ failedChunks: 1 })).failed).toBe(true);
  });

  it('old plan: planDatasetVersion set and different', () => {
    expect(viewState(withNet(3), status({ planDatasetVersion: 'fixture-0' })).oldPlan).toBe(true);
    expect(
      viewState(withNet(3), status({ planDatasetVersion: '2026-10-10-abcdef12' })).oldPlan
    ).toBe(false);
    expect(viewState(withNet(3), status()).oldPlan).toBe(false);
  });
});

describe('text', () => {
  it('primary target is matched by id, not position or identity', () => {
    const s = withNet(10);
    const swapped: Score = { ...s, targets: [s.targets[1], structuredClone(s.targets[0])] };
    expect(primaryTarget(swapped)?.target.id).toBe('rhna');
    expect(primaryTarget({ ...s, targets: [] })).toBeUndefined();
  });

  it('announcement: "Net new homes {net}, {pct} of RHNA"', () => {
    expect(announcement(withNet(41035))).toBe('Net new homes 41,035, 50% of RHNA');
    expect(announcement(withNet(0))).toBe('Net new homes 0, 0% of RHNA');
  });

  it('mobile bar text, compact at ≥ 100,000', () => {
    expect(barText(withNet(8))).toBe('8 net new homes · 0.0% of RHNA');
    expect(barText(withNet(123456))).toBe('123.5K net new homes · 150% of RHNA');
  });

  it('secondary line: "{gross} built · {demolished} replaced · {parcelsChanged} parcels changed"', () => {
    const p = parcel('9000002', 3, 'Mission');
    const s = score([[p, building(p, 12, true)]], M1_TARGETS);
    expect(secondaryText(s)).toBe('12 built · 3 replaced · 1 parcels changed');
  });

  it('footnote lead: "Data {v} · built {YYYY-MM-DD}"; omits built when unknown', () => {
    expect(footnoteLead(status())).toBe('Data 2026-10-10-abcdef12 · built 2026-10-10');
    expect(footnoteLead(status({ builtAt: '' }))).toBe('Data 2026-10-10-abcdef12');
  });

  it('old plan note', () => {
    expect(oldPlanNote(status({ planDatasetVersion: 'fixture-0' }))).toBe(
      'plan made on data fixture-0, recalculated on current data'
    );
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `./node_modules/.bin/vitest --run --project server src/lib/scoreboard/view.spec.ts`
Expected: FAIL, because `./view` does not resolve.

- [ ] **Step 3: Write `src/lib/scoreboard/view.ts`**

```ts
// Spec §4.4 / §4.7 view logic. Pure; no DOM.
import type { BuildoutMode } from '$lib/generator';
import { formatBuiltDate, formatCompactCount, formatCount, formatPercent } from './format';
import type { Score, TargetProgress } from './types';

/**
 * UI-only input (spec §2), derived on the main thread from I15: 'chunks' → pending/failed,
 * 'diff'.complete, the manifest → datasetVersion/builtAt. `complete` is added here because §4.4's
 * "updating" state reads it.
 */
export interface ScoreStatus {
  pendingChunks: number;
  failedChunks: number;
  complete: boolean;
  datasetVersion: string;
  builtAt: string;
  planDatasetVersion?: string;
  mode: BuildoutMode;
}

/** Badge copy keyed by mode (§5 seam: M2 adds 'likely'). */
export const BADGE: Record<BuildoutMode, string> = { max: 'Theoretical max buildout' };
export const PRIMARY_TARGET_ID = 'rhna';
export const NEIGHBORHOOD_TOP = 10;

/** Full-scale value shared by every bar: max(1, ceil(maxFraction·2)/2). */
export function trackMax(targets: readonly TargetProgress[]): number {
  const maxFraction = Math.max(0, ...targets.map((t) => t.fraction));
  return Math.max(1, Math.ceil(maxFraction * 2) / 2);
}

/** Fill width as % of the track; drawn from 0, so negatives are 0. Never clamped above. */
export function fillPercent(fraction: number, max: number): number {
  return (Math.max(0, fraction) / max) * 100;
}

/** Position of the 100%-of-target tick as % of the track. */
export function tickPercent(max: number): number {
  return 100 / max;
}

export function remainderText(netUnits: number, targetUnits: number): string {
  return netUnits < targetUnits
    ? `${formatCount(targetUnits - netUnits)} to go`
    : `${formatCount(netUnits - targetUnits)} over target`;
}

export function meterValueText(tp: TargetProgress): string {
  return `${formatPercent(tp.fraction)} of ${tp.target.label}`;
}

export interface NeighborhoodRow {
  name: string;
  net: number;
}

export function neighborhoodRows(by: Record<string, number>): NeighborhoodRow[] {
  return Object.entries(by)
    .map(([name, net]) => ({ name, net }))
    .sort((a, b) => b.net - a.net || a.name.localeCompare(b.name, 'en'));
}

export interface ViewState {
  empty: boolean;
  updating: boolean;
  failed: boolean;
  oldPlan: boolean;
}

export function viewState(score: Score, status: ScoreStatus): ViewState {
  return {
    empty: score.parcelsChanged === 0 && status.pendingChunks === 0,
    updating: status.pendingChunks > 0 || !status.complete,
    failed: status.failedChunks > 0,
    oldPlan: !!status.planDatasetVersion && status.planDatasetVersion !== status.datasetVersion
  };
}

/** RHNA by id (scores arrive via structured clone); falls back to the first target. */
export function primaryTarget(score: Score): TargetProgress | undefined {
  return score.targets.find((t) => t.target.id === PRIMARY_TARGET_ID) ?? score.targets[0];
}

function ofRhna(score: Score): string {
  const p = primaryTarget(score);
  return p ? `${formatPercent(p.fraction)} of RHNA` : '';
}

/** §4.7 aria-live text. */
export function announcement(score: Score): string {
  const pct = ofRhna(score);
  return `Net new homes ${formatCount(score.netUnits)}` + (pct ? `, ${pct}` : '');
}

/** §4.4 mobile collapsed bar. */
export function barText(score: Score): string {
  const pct = ofRhna(score);
  return `${formatCompactCount(score.netUnits)} net new homes` + (pct ? ` · ${pct}` : '');
}

export function secondaryText(score: Score): string {
  return (
    `${formatCount(score.grossUnits)} built · ${formatCount(score.demolishedUnits)} replaced · ` +
    `${formatCount(score.parcelsChanged)} parcels changed`
  );
}

/** Footnote text before the "Sources" link. */
export function footnoteLead(status: ScoreStatus): string {
  const built = status.builtAt ? ` · built ${formatBuiltDate(status.builtAt)}` : '';
  return `Data ${status.datasetVersion}${built}`;
}

export function oldPlanNote(status: ScoreStatus): string {
  return `plan made on data ${status.planDatasetVersion}, recalculated on current data`;
}
```

- [ ] **Step 4: Append to `src/lib/scoreboard/index.ts`**

```ts
export {
  BADGE,
  NEIGHBORHOOD_TOP,
  PRIMARY_TARGET_ID,
  announcement,
  barText,
  fillPercent,
  footnoteLead,
  meterValueText,
  neighborhoodRows,
  oldPlanNote,
  primaryTarget,
  remainderText,
  secondaryText,
  tickPercent,
  trackMax,
  viewState
} from './view';
export type { NeighborhoodRow, ScoreStatus, ViewState } from './view';
```

- [ ] **Step 5: Run, lint, commit**

Run: `./node_modules/.bin/vitest --run --project server src/lib/scoreboard`. Expected: PASS.
Run: `npx prettier --write src/lib/scoreboard && npx eslint src/lib/scoreboard`.

```bash
git add src/lib/scoreboard docs/superpowers/plans/2026-10-11-scoreboard-stage2-ui.md
git commit -m "feat(scoreboard): pure view helpers for the UI"
```

---

### Task 2: Panel components (`TargetRow`, `NeighborhoodList`, `ScoreboardPanel`)

**Files:**
- Create: `src/lib/scoreboard/TargetRow.svelte`, `src/lib/scoreboard/NeighborhoodList.svelte`, `src/lib/scoreboard/ScoreboardPanel.svelte`
- Test: `src/lib/scoreboard/ScoreboardPanel.svelte.spec.ts`

**Interfaces:**
- Consumes: everything in Task 1's Produces; `formatCount` and `formatPercent` from `./format`; `Score` from `./types`.
- Produces:
  - `TargetRow` props `{ tp: TargetProgress; net: number; max: number; primary: boolean }`
  - `NeighborhoodList` props `{ rows: NeighborhoodRow[] }`
  - `ScoreboardPanel` props `{ score: Score; status: ScoreStatus; onretry?: () => void }`

`ScoreboardPanel` renders the following top to bottom (spec §4.4 order, with the state rows after the headline):

1. The badge `BADGE[status.mode]`.
2. The headline: the net count in `data-testid="score-net"` plus the text "net new homes".
3. If updating: an `aria-hidden` spinner (`motion-safe:animate-spin`) and the text "Updating…".
4. If failed: a warning row reading "Some areas didn't load ({failedChunks}). Totals leave them out.", with a **Retry** button that calls `onretry`. It carries a "⚠" text glyph as well as colour.
5. If empty: the hint "Paint a height on the map to add homes."
6. One `TargetRow` per `score.targets`, keyed by `target.id`, using a shared `max = trackMax(score.targets)`. Only index 0 is `primary`.
7. The secondary line `secondaryText(score)`.
8. If `score.parcelsChanged > 0`: `<details>` with `<summary>By neighborhood</summary>` and a `NeighborhoodList`. It is collapsed by default.
9. `<details>` with `<summary>What does this number mean?</summary>`, containing the §4.6 copy **verbatim** (below), then one source link per target: `{target.label}: {source.label}` linking to `source.url`.
10. The footnote: `{footnoteLead(status)} · <a href="/attribution">Sources</a>`, plus ` · {oldPlanNote(status)}` when `oldPlan`.

§4.6 copy, verbatim. Bold leads go in `<strong>`.

> **Theoretical max buildout.** This counts every home the heights you painted would allow if every eligible parcel under your strokes were rebuilt to the maximum, all at once, today. It is not a forecast: real construction depends on cost, demand, permitting and time.
>
> **Net, not gross.** When a new building replaces an existing one, the homes in the old building are subtracted. Backyard cottages (1–2 stories painted on a lot with homes) keep the existing building and add one home.
>
> **Targets.** RHNA is the state-assigned number of homes San Francisco must plan for in 2023–2031 (82,069). The state also expects a buffer of at least 15% (94,379). Going past 100% is meaningful: SF is far behind, and more housing than the minimum is a real policy choice.

- [ ] **Step 1: Write the failing test** `src/lib/scoreboard/ScoreboardPanel.svelte.spec.ts`

```ts
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { score } from './accumulator';
import { building, parcel } from './score-fixtures';
import ScoreboardPanel from './ScoreboardPanel.svelte';
import { M1_TARGETS } from './targets';
import type { Score } from './types';
import type { ScoreStatus } from './view';

const status = (s: Partial<ScoreStatus> = {}): ScoreStatus => ({
  pendingChunks: 0,
  failedChunks: 0,
  complete: true,
  datasetVersion: '2026-10-10-abcdef12',
  builtAt: '2026-10-10T12:00:00Z',
  mode: 'max',
  ...s
});

/** One parcel per neighborhood with the given net (vacant replacements). */
function scoreOf(hoods: Record<string, number>): Score {
  return score(
    Object.entries(hoods).map(([h, net], i) => {
      const p = parcel(String(8_000_000 + i), 0, h);
      return [p, building(p, net, true)] as [typeof p, ReturnType<typeof building>];
    }),
    M1_TARGETS
  );
}

function show(s: Score, st: ScoreStatus = status()) {
  const onretry = vi.fn();
  render(ScoreboardPanel, { props: { score: s, status: st, onretry } });
  return { onretry };
}

const COPY_LEADS = ['Theoretical max buildout.', 'Net, not gross.', 'Targets.'];

describe('ScoreboardPanel states (§4.4)', () => {
  it('empty: net 0, 0% on both targets, hint, no neighborhood disclosure', async () => {
    show(score([], M1_TARGETS));
    await expect.element(page.getByTestId('score-net')).toHaveTextContent('0');
    await expect.element(page.getByText('Paint a height on the map to add homes.')).toBeVisible();
    const meters = page.getByRole('meter');
    expect(meters.elements()).toHaveLength(2);
    for (const m of meters.elements()) expect(m.getAttribute('aria-valuetext')).toMatch(/^0% of /);
    expect(page.getByText('By neighborhood').elements()).toHaveLength(0);
  });

  it('badge and §4.6 copy are present in every state', async () => {
    for (const st of [
      status(),
      status({ pendingChunks: 2 }),
      status({ failedChunks: 1 }),
      status({ planDatasetVersion: 'fixture-0' })
    ]) {
      const screen = render(ScoreboardPanel, { props: { score: scoreOf({ Mission: 5 }), status: st } });
      await expect.element(page.getByText('Theoretical max buildout', { exact: true })).toBeVisible();
      for (const lead of COPY_LEADS)
        expect(page.getByText(lead, { exact: true }).elements().length).toBeGreaterThan(0);
      screen.unmount();
    }
  });

  it('updating: spinner and "Updating…", numbers shown as-is', async () => {
    show(scoreOf({ Mission: 5 }), status({ complete: false }));
    await expect.element(page.getByText('Updating…')).toBeVisible();
    await expect.element(page.getByTestId('score-net')).toHaveTextContent('5');
  });

  it('partial failure: warning text and Retry emits', async () => {
    const { onretry } = show(scoreOf({ Mission: 5 }), status({ failedChunks: 3 }));
    await expect
      .element(page.getByText("Some areas didn't load (3). Totals leave them out."))
      .toBeVisible();
    await page.getByRole('button', { name: 'Retry' }).click();
    expect(onretry).toHaveBeenCalledTimes(1);
  });

  it('old plan: footnote adds the recalculated note; Sources links to /attribution', async () => {
    show(scoreOf({ Mission: 5 }), status({ planDatasetVersion: 'fixture-0' }));
    await expect
      .element(page.getByText(/plan made on data fixture-0, recalculated on current data/))
      .toBeVisible();
    await expect.element(page.getByText(/Data 2026-10-10-abcdef12 · built 2026-10-10/)).toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'Sources' }))
      .toHaveAttribute('href', '/attribution');
  });

  it('overshoot: "180%", fill past the tick, "over target"', async () => {
    show(scoreOf({ Mission: 147725 })); // 1.800009 of rhna
    const row = page.getByTestId('target-rhna');
    await expect.element(row.getByText('180%', { exact: true })).toBeVisible();
    await expect.element(row.getByText('65,656 over target')).toBeVisible();
    const fill = row.getByTestId('bar-fill').element() as HTMLElement;
    const tick = row.getByTestId('bar-tick').element() as HTMLElement;
    expect(fill.getBoundingClientRect().right).toBeGreaterThan(tick.getBoundingClientRect().left);
    expect(parseFloat(fill.style.width)).toBeCloseTo(90, 1); // track grows to 200%
    const meter = row.getByRole('meter').element();
    expect(meter.getAttribute('aria-valuemax')).toBe(String(2 * 82069));
    expect(meter.getAttribute('aria-valuenow')).toBe('147725');
    expect(meter.getAttribute('aria-valuetext')).toBe('180% of RHNA 2023–2031');
  });

  it('headline is net; gross only in the secondary line', async () => {
    const p = parcel('8100000', 3, 'Mission');
    show(score([[p, building(p, 12, true)]], M1_TARGETS));
    await expect.element(page.getByTestId('score-net')).toHaveTextContent('9');
    await expect.element(page.getByText('12 built · 3 replaced · 1 parcels changed')).toBeVisible();
  });

  it('targets render generically, keyed by id, first is primary', async () => {
    show(scoreOf({ Mission: 5 }));
    await expect.element(page.getByTestId('target-rhna')).toHaveAttribute('data-primary', 'true');
    await expect
      .element(page.getByTestId('target-rhna-buffer'))
      .toHaveAttribute('data-primary', 'false');
  });

  it('each target source link is shown under the copy', async () => {
    show(scoreOf({ Mission: 5 }));
    await page.getByText('What does this number mean?').click();
    const links = page.getByRole('link', { name: /RHNA Primer/ }).elements();
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe(M1_TARGETS[0].source.url);
  });
});

describe('neighborhood list', () => {
  it('sorts by net desc then name, shows top 10, then "Show all {k}"', async () => {
    const hoods: Record<string, number> = {};
    for (let i = 0; i < 12; i++) hoods[`Hood ${String.fromCharCode(65 + i)}`] = 100 - i;
    hoods['Aaa Tie'] = 100; // ties with Hood A → name order puts "Aaa Tie" first
    show(scoreOf(hoods));
    await page.getByText('By neighborhood').click();
    const items = () => page.getByTestId('hood-row').elements();
    await expect.poll(() => items().length).toBe(10);
    expect(items()[0].textContent).toContain('Aaa Tie');
    expect(items()[1].textContent).toContain('Hood A');
    await page.getByRole('button', { name: 'Show all 13' }).click();
    await expect.poll(() => items().length).toBe(13);
    expect(page.getByRole('button', { name: /Show all/ }).elements()).toHaveLength(0);
  });

  it('is collapsed by default', async () => {
    show(scoreOf({ Mission: 5 }));
    const details = page.getByText('By neighborhood').element().closest('details')!;
    expect(details.open).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `./node_modules/.bin/vitest --run --project client src/lib/scoreboard/ScoreboardPanel.svelte.spec.ts`
Expected: FAIL, because the component does not exist.

- [ ] **Step 3: Write `TargetRow.svelte`**

```svelte
<script lang="ts">
  import { formatPercent } from './format';
  import type { TargetProgress } from './types';
  import { fillPercent, meterValueText, remainderText, tickPercent } from './view';

  interface Props {
    tp: TargetProgress;
    net: number;
    /** Shared track full-scale (trackMax). */
    max: number;
    primary: boolean;
  }
  let { tp, net, max, primary }: Props = $props();
  const tick = $derived(tickPercent(max));
</script>

<div class="mt-3" data-testid="target-{tp.target.id}" data-primary={String(primary)}>
  <div class="flex items-baseline justify-between gap-2">
    <span class={primary ? 'text-sm font-semibold' : 'text-sm'}>{tp.target.label}</span>
    <span class={primary ? 'text-lg font-bold tabular-nums' : 'text-sm tabular-nums'}
      >{formatPercent(tp.fraction)}</span
    >
  </div>
  <div
    role="meter"
    aria-label={tp.target.label}
    aria-valuemin={0}
    aria-valuemax={max * tp.target.units}
    aria-valuenow={net}
    aria-valuetext={meterValueText(tp)}
    class="relative mt-1 overflow-visible rounded-sm bg-gray-200 {primary ? 'h-4' : 'h-2.5'}"
  >
    <div
      data-testid="bar-fill"
      class="absolute inset-y-0 left-0 rounded-sm {primary ? 'bg-blue-700' : 'bg-blue-500'}"
      style:width="{fillPercent(tp.fraction, max)}%"
    ></div>
    <div
      data-testid="bar-tick"
      class="absolute -inset-y-1 w-0.5 -translate-x-1/2 bg-black"
      style:left="{tick}%"
    ></div>
  </div>
  <div class="relative h-4 text-xs text-gray-700" aria-hidden="true">
    <span
      class="absolute whitespace-nowrap {tick >= 99 ? '-translate-x-full' : '-translate-x-1/2'}"
      style:left="{tick}%">target</span
    >
  </div>
  <p class="text-sm text-gray-800">{remainderText(net, tp.target.units)}</p>
</div>
```

- [ ] **Step 4: Write `NeighborhoodList.svelte`**

```svelte
<script lang="ts">
  import { formatCount } from './format';
  import { NEIGHBORHOOD_TOP, type NeighborhoodRow } from './view';

  interface Props {
    rows: NeighborhoodRow[];
  }
  let { rows }: Props = $props();
  let showAll = $state(false);
  const visible = $derived(showAll ? rows : rows.slice(0, NEIGHBORHOOD_TOP));
  const largest = $derived(Math.max(0, ...rows.map((r) => r.net)));
</script>

<ul class="mt-2 space-y-1">
  {#each visible as r (r.name)}
    <li data-testid="hood-row" class="text-sm">
      <div class="flex justify-between gap-2">
        <span class="truncate">{r.name}</span>
        <span class="tabular-nums">{formatCount(r.net)}</span>
      </div>
      <div class="h-1.5 rounded-sm bg-gray-100" aria-hidden="true">
        <div
          class="h-full rounded-sm bg-blue-600"
          style:width="{largest > 0 ? (Math.max(0, r.net) / largest) * 100 : 0}%"
        ></div>
      </div>
    </li>
  {/each}
</ul>
{#if !showAll && rows.length > NEIGHBORHOOD_TOP}
  <button
    type="button"
    class="mt-2 min-h-11 text-sm font-semibold underline"
    onclick={() => (showAll = true)}>Show all {rows.length}</button
  >
{/if}
```

- [ ] **Step 5: Write `ScoreboardPanel.svelte`**

```svelte
<script lang="ts">
  import { formatCount } from './format';
  import NeighborhoodList from './NeighborhoodList.svelte';
  import TargetRow from './TargetRow.svelte';
  import type { Score } from './types';
  import {
    BADGE,
    footnoteLead,
    neighborhoodRows,
    oldPlanNote,
    secondaryText,
    trackMax,
    viewState,
    type ScoreStatus
  } from './view';

  interface Props {
    score: Score;
    status: ScoreStatus;
    onretry?: () => void;
  }
  let { score, status, onretry }: Props = $props();
  const view = $derived(viewState(score, status));
  const max = $derived(trackMax(score.targets));
</script>

<div class="text-black">
  <p
    class="inline-block rounded-full border border-gray-700 px-2 py-0.5 text-xs font-semibold tracking-wide uppercase"
  >
    {BADGE[status.mode]}
  </p>
  <p class="mt-2">
    <span data-testid="score-net" class="text-3xl font-bold tabular-nums"
      >{formatCount(score.netUnits)}</span
    >
    <span class="text-base">net new homes</span>
  </p>

  {#if view.updating}
    <p class="mt-1 flex items-center gap-2 text-sm text-gray-800">
      <span
        aria-hidden="true"
        class="inline-block h-3.5 w-3.5 rounded-full border-2 border-gray-400 border-t-gray-900 motion-safe:animate-spin"
      ></span>
      Updating…
    </p>
  {/if}

  {#if view.failed}
    <div class="mt-2 flex items-start gap-2 rounded-md border border-amber-700 bg-amber-50 p-2">
      <p class="text-sm">
        <span aria-hidden="true">⚠ </span>Some areas didn't load ({status.failedChunks}). Totals
        leave them out.
      </p>
      <button
        type="button"
        class="min-h-11 min-w-11 shrink-0 rounded-md px-2 text-sm font-semibold underline"
        onclick={() => onretry?.()}>Retry</button
      >
    </div>
  {/if}

  {#if view.empty}
    <p class="mt-2 text-sm text-gray-800">Paint a height on the map to add homes.</p>
  {/if}

  {#each score.targets as tp, i (tp.target.id)}
    <TargetRow {tp} net={score.netUnits} {max} primary={i === 0} />
  {/each}

  <p class="mt-3 text-sm text-gray-800">{secondaryText(score)}</p>

  {#if score.parcelsChanged > 0}
    <details class="mt-3">
      <summary class="min-h-6 cursor-pointer text-sm font-semibold">By neighborhood</summary>
      <NeighborhoodList rows={neighborhoodRows(score.byNeighborhood)} />
    </details>
  {/if}

  <details class="mt-3">
    <summary class="min-h-6 cursor-pointer text-sm font-semibold"
      >What does this number mean?</summary
    >
    <div class="mt-2 space-y-2 text-sm">
      <p>
        <strong>Theoretical max buildout.</strong> This counts every home the heights you painted
        would allow if every eligible parcel under your strokes were rebuilt to the maximum, all at
        once, today. It is not a forecast: real construction depends on cost, demand, permitting and
        time.
      </p>
      <p>
        <strong>Net, not gross.</strong> When a new building replaces an existing one, the homes in
        the old building are subtracted. Backyard cottages (1–2 stories painted on a lot with homes)
        keep the existing building and add one home.
      </p>
      <p>
        <strong>Targets.</strong> RHNA is the state-assigned number of homes San Francisco must plan
        for in 2023–2031 (82,069). The state also expects a buffer of at least 15% (94,379). Going
        past 100% is meaningful: SF is far behind, and more housing than the minimum is a real
        policy choice.
      </p>
      <ul class="space-y-1">
        {#each score.targets as tp (tp.target.id)}
          <li>
            <a class="underline" href={tp.target.source.url} rel="external noopener"
              >{tp.target.label}: {tp.target.source.label}</a
            >
          </li>
        {/each}
      </ul>
    </div>
  </details>

  <p class="mt-3 text-xs text-gray-700">
    {footnoteLead(status)} · <a class="underline" href="/attribution">Sources</a>{#if view.oldPlan}
      · {oldPlanNote(status)}{/if}
  </p>
</div>
```

Prettier may reflow the copy paragraphs. Whitespace collapses in HTML, so the rendered text is unchanged. Verify that `getByText('Theoretical max buildout.', { exact: true })` matches the `<strong>` element. If the footnote's `{#if}` produces doubled spaces, normalise it: the tests use regexes on the footnote.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `./node_modules/.bin/vitest --run --project client src/lib/scoreboard/ScoreboardPanel.svelte.spec.ts`
Expected: PASS. If a selector fails only because of how the test locates something (for example, multiple matches), fix the selector. Never weaken the assertion.

- [ ] **Step 7: Run check and lint, then commit**

Run: `npm run check` (0 errors), then `npx prettier --write src/lib/scoreboard && npx eslint src/lib/scoreboard`.

```bash
git add src/lib/scoreboard
git commit -m "feat(scoreboard): panel, target rows and neighborhood list"
```

---

### Task 3: `Scoreboard` shell (layout, sheet, live region, frame coalescing)

**Files:**
- Create: `src/lib/scoreboard/latest.svelte.ts`, `src/lib/scoreboard/Scoreboard.svelte`
- Modify: `src/lib/scoreboard/index.ts` (append `frameLatest`. Do NOT export `.svelte` components from the barrel. Import them by path, as `$lib/brush/BrushEditor.svelte` is.)
- Test: `src/lib/scoreboard/Scoreboard.svelte.spec.ts`

**Interfaces:**
- Consumes: `ScoreboardPanel` (Task 2); `ScoreStatus`, `announcement`, `barText` and `BADGE` (Task 1); `score` from `./accumulator` and `M1_TARGETS` from `./targets`.
- Produces:
  - `export function frameLatest<T>(initial: T, raf?: (cb: FrameRequestCallback) => number, caf?: (h: number) => void): { readonly current: T; push(v: T): void; dispose(): void }`
  - `Scoreboard` props `{ score: Score | null; status: ScoreStatus; onretry?: () => void; onsheetchange?: (open: boolean, heightPx: number) => void }`

Behaviour:

- **Root:** `<div class="sfh-scoreboard" role="region" aria-label="Housing scoreboard">`.
  - `score === null` renders `score([], M1_TARGETS)`, a module-level constant.
- **Desktop (≥ 768 px):**
  - A panel `hidden md:block absolute top-4 right-4 z-20 w-80 max-h-[calc(100%-2rem)] overflow-y-auto rounded-lg bg-white p-4 shadow-lg` containing `ScoreboardPanel`.
  - It is positioned against the page's `#map-region`, which is `relative`.
- **Mobile (< 768 px):**
  - A bar `fixed inset-x-0 bottom-0 z-20 h-14 md:hidden`, holding a full-width `<button aria-expanded={open} aria-controls={sheetId}>`.
  - The button text is two lines: line 1 is `barText(score)`, line 2 is a small caption `BADGE[status.mode]`.
  - Ruling: the badge also shows on the bar, for honesty of numbers. The spec's bar text is kept verbatim on line 1.
  - Tapping the bar opens the sheet.
- **Sheet:**
  - `{#if open}`: `<div id={sheetId} role="group" aria-label="Scoreboard details" class="fixed inset-x-0 bottom-0 z-30 max-h-[85dvh] overflow-y-auto rounded-t-xl bg-white p-4 shadow-2xl md:hidden" bind:offsetHeight={sheetH}>`.
  - It contains a **Close** button (`min-h-11`) and `ScoreboardPanel`.
  - It covers the brush bar (z-30 over z-20).
  - Escape inside the sheet closes it.
  - On open, focus moves to Close. On close, focus returns to the bar button.
- **Sheet callback:** `$effect` calls `onsheetchange?.(open, open ? sheetH : 0)` whenever `open` or `sheetH` changes, and once with `false` on destroy if the sheet was open.
  - A `matchMedia('(min-width: 768px)')` change to matches closes the sheet.
- **`--scorebar-h`:** set through the component `<style>` as `@media (max-width: 767px) { :global(:root:has(.sfh-scoreboard)) { --scorebar-h: 56px; } }`.
  - It applies only while the scoreboard is in the DOM, and only at narrow widths.
  - BrushEditor's `applyInset` reads it from `documentElement`, and BrushToolbar's `bottom-[var(--scorebar-h,0px)]` inherits it.
- **Live region:**
  - A single `<p class="sr-only" aria-live="polite" data-testid="score-live">{live}</p>`, outside the panel and sheet.
  - `$effect`: compute `msg = announcement(shown)` and `busy = viewState(...).updating`.
  - If busy, or `msg === lastSpoken`, do nothing.
  - Otherwise `setTimeout(1000)` sets `lastSpoken = msg; live = msg`. The cleanup clears the timer.
  - `lastSpoken` starts as the initial `announcement` (`untrack`), so the first render is silent.
- **No count-up animation:** values render directly.

`latest.svelte.ts`:

```ts
/**
 * Latest-value holder that commits to reactive state at most once per animation frame (spec
 * §4.3: the main thread renders the latest score at most once per frame). `push` may be called
 * any number of times per frame; the last value wins and is never dropped.
 */
export function frameLatest<T>(
  initial: T,
  raf: (cb: FrameRequestCallback) => number = (cb) => requestAnimationFrame(cb),
  caf: (h: number) => void = (h) => cancelAnimationFrame(h)
): { readonly current: T; push(v: T): void; dispose(): void } {
  let current = $state.raw(initial);
  let pending: { v: T } | null = null;
  let handle = 0;
  return {
    get current() {
      return current;
    },
    push(v) {
      pending = { v };
      if (handle) return;
      handle = raf(() => {
        handle = 0;
        if (pending) {
          current = pending.v;
          pending = null;
        }
      });
    },
    dispose() {
      if (handle) caf(handle);
      handle = 0;
      pending = null;
    }
  };
}
```

`Scoreboard.svelte`:

```svelte
<script module lang="ts">
  import { score as computeScore } from './accumulator';
  import { M1_TARGETS } from './targets';
  const EMPTY = computeScore([], M1_TARGETS);
  const WIDE = '(min-width: 768px)';
</script>

<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import ScoreboardPanel from './ScoreboardPanel.svelte';
  import type { Score } from './types';
  import { announcement, BADGE, barText, viewState, type ScoreStatus } from './view';

  interface Props {
    /** Latest score from the worker (`null` before the first diff → empty). */
    score: Score | null;
    status: ScoreStatus;
    /** Partial-failure Retry: the shell sends brush-tool's `retryChunks`. */
    onretry?: () => void;
    /** Mobile sheet opened/closed or resized: the shell adjusts the map's bottom inset. */
    onsheetchange?: (open: boolean, heightPx: number) => void;
  }
  let { score, status, onretry, onsheetchange }: Props = $props();

  const sheetId = $props.id() + '-sheet';
  const shown = $derived(score ?? EMPTY);
  const view = $derived(viewState(shown, status));

  let open = $state(false);
  let sheetH = $state(0);
  let barButton = $state<HTMLButtonElement>();
  let closeButton = $state<HTMLButtonElement>();

  async function openSheet(): Promise<void> {
    open = true;
    await tick();
    closeButton?.focus();
  }
  async function closeSheet(): Promise<void> {
    open = false;
    await tick();
    barButton?.focus();
  }

  $effect(() => {
    onsheetchange?.(open, open ? sheetH : 0);
  });

  onMount(() => {
    const mq = matchMedia(WIDE);
    const onChange = () => {
      if (mq.matches) open = false;
    };
    mq.addEventListener('change', onChange);
    return () => {
      mq.removeEventListener('change', onChange);
      if (untrack(() => open)) onsheetchange?.(false, 0);
    };
  });

  let live = $state('');
  let lastSpoken = untrack(() => announcement(shown));
  $effect(() => {
    const msg = announcement(shown);
    if (view.updating || msg === lastSpoken) return;
    const t = setTimeout(() => {
      lastSpoken = msg;
      live = msg;
    }, 1000);
    return () => clearTimeout(t);
  });
</script>

<div class="sfh-scoreboard" role="region" aria-label="Housing scoreboard">
  <div
    class="absolute top-4 right-4 z-20 hidden max-h-[calc(100%-2rem)] w-80 overflow-y-auto rounded-lg bg-white p-4 shadow-lg md:block"
  >
    <ScoreboardPanel score={shown} {status} {onretry} />
  </div>

  <div class="fixed inset-x-0 bottom-0 z-20 h-14 border-t border-gray-300 bg-white md:hidden">
    <button
      bind:this={barButton}
      type="button"
      class="flex h-full w-full flex-col items-start justify-center px-4 text-left text-black"
      aria-expanded={open}
      aria-controls={sheetId}
      onclick={() => void openSheet()}
    >
      <span class="text-sm font-semibold" data-testid="scorebar-text">{barText(shown)}</span>
      <span class="text-xs text-gray-700">{BADGE[status.mode]}</span>
    </button>
  </div>

  {#if open}
    <div
      id={sheetId}
      role="group"
      aria-label="Scoreboard details"
      class="fixed inset-x-0 bottom-0 z-30 max-h-[85dvh] overflow-y-auto rounded-t-xl bg-white p-4 shadow-2xl md:hidden"
      bind:offsetHeight={sheetH}
      onkeydown={(e) => {
        if (e.key === 'Escape') void closeSheet();
      }}
    >
      <div class="flex justify-end">
        <button
          bind:this={closeButton}
          type="button"
          class="min-h-11 min-w-11 rounded-md px-3 text-sm font-semibold underline"
          onclick={() => void closeSheet()}>Close</button
        >
      </div>
      <ScoreboardPanel score={shown} {status} {onretry} />
    </div>
  {/if}

  <p class="sr-only" aria-live="polite" data-testid="score-live">{live}</p>
</div>

<style>
  @media (max-width: 767px) {
    :global(:root:has(.sfh-scoreboard)) {
      --scorebar-h: 56px;
    }
  }
</style>
```

If `svelte-check` flags `role="group"` with `onkeydown` (a11y_no_noninteractive_element_interactions), attach the Escape handler through `<svelte:window onkeydown>` guarded by `open`. Keep the behaviour the same.

- [ ] **Step 1: Write the failing test** `src/lib/scoreboard/Scoreboard.svelte.spec.ts`

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { score } from './accumulator';
import { frameLatest } from './latest.svelte';
import Scoreboard from './Scoreboard.svelte';
import { building, parcel } from './score-fixtures';
import { M1_TARGETS } from './targets';
import type { Score } from './types';
import type { ScoreStatus } from './view';

const status = (s: Partial<ScoreStatus> = {}): ScoreStatus => ({
  pendingChunks: 0,
  failedChunks: 0,
  complete: true,
  datasetVersion: 'fixture-0',
  builtAt: '2026-10-10T12:00:00Z',
  mode: 'max',
  ...s
});

function withNet(net: number): Score {
  const p = parcel('7000001', 0, 'Mission');
  return score([[p, building(p, net, true)]], M1_TARGETS);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Scoreboard region', () => {
  it('is a region labelled "Housing scoreboard"; null score renders empty', async () => {
    await page.viewport(1280, 800);
    render(Scoreboard, { props: { score: null, status: status() } });
    await expect.element(page.getByRole('region', { name: 'Housing scoreboard' })).toBeVisible();
    await expect.element(page.getByTestId('score-net').first()).toHaveTextContent('0');
  });

  it('desktop: docked panel visible, mobile bar hidden', async () => {
    await page.viewport(1280, 800);
    render(Scoreboard, { props: { score: withNet(5), status: status() } });
    await expect.element(page.getByTestId('score-net').first()).toBeVisible();
    await expect.element(page.getByTestId('scorebar-text')).not.toBeVisible();
  });
});

describe('375 px', () => {
  it('collapsed bar shows "{net} net new homes · {pct} of RHNA", 56 px tall, and sets --scorebar-h', async () => {
    await page.viewport(375, 812);
    render(Scoreboard, { props: { score: withNet(41035), status: status() } });
    const bar = page.getByTestId('scorebar-text');
    await expect.element(bar).toHaveTextContent('41,035 net new homes · 50% of RHNA');
    const btn = page.getByRole('button', { name: /net new homes/ }).element();
    expect(btn.getBoundingClientRect().height).toBe(56);
    expect(getComputedStyle(document.documentElement).getPropertyValue('--scorebar-h').trim()).toBe(
      '56px'
    );
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
  });

  it('tapping opens the sheet (focus to Close), reports its height; Close restores', async () => {
    await page.viewport(375, 812);
    const onsheetchange = vi.fn();
    render(Scoreboard, { props: { score: withNet(5), status: status(), onsheetchange } });
    const barBtn = page.getByRole('button', { name: /net new homes/ });
    await barBtn.click();
    await expect.element(barBtn).toHaveAttribute('aria-expanded', 'true');
    const close = page.getByRole('button', { name: 'Close' });
    await expect.element(close).toHaveFocus();
    await expect.element(page.getByRole('group', { name: 'Scoreboard details' })).toBeVisible();
    await expect
      .poll(() => onsheetchange.mock.calls.at(-1))
      .toEqual([true, expect.any(Number)]);
    expect(onsheetchange.mock.calls.at(-1)![1]).toBeGreaterThan(56);
    await close.click();
    await expect.element(barBtn).toHaveFocus();
    expect(onsheetchange.mock.calls.at(-1)).toEqual([false, 0]);
  });

  it('Escape closes the sheet', async () => {
    await page.viewport(375, 812);
    render(Scoreboard, { props: { score: withNet(5), status: status() } });
    await page.getByRole('button', { name: /net new homes/ }).click();
    await userEvent.keyboard('{Escape}');
    await expect
      .element(page.getByRole('group', { name: 'Scoreboard details' }))
      .not.toBeInTheDocument();
  });

  it('widening past 768 px closes the sheet and reports closed', async () => {
    await page.viewport(375, 812);
    const onsheetchange = vi.fn();
    render(Scoreboard, { props: { score: withNet(5), status: status(), onsheetchange } });
    await page.getByRole('button', { name: /net new homes/ }).click();
    await page.viewport(1024, 768);
    await expect.poll(() => onsheetchange.mock.calls.at(-1)).toEqual([false, 0]);
  });

  it('unmounting with the sheet open reports closed', async () => {
    await page.viewport(375, 812);
    const onsheetchange = vi.fn();
    const screen = render(Scoreboard, {
      props: { score: withNet(5), status: status(), onsheetchange }
    });
    await page.getByRole('button', { name: /net new homes/ }).click();
    screen.unmount();
    expect(onsheetchange.mock.calls.at(-1)).toEqual([false, 0]);
    expect(getComputedStyle(document.documentElement).getPropertyValue('--scorebar-h').trim()).toBe(
      ''
    );
  });
});

describe('aria-live (§4.7)', () => {
  it('silent on first render; announces 1 s after the last change once settled', async () => {
    vi.useFakeTimers();
    await page.viewport(1280, 800);
    const screen = render(Scoreboard, { props: { score: withNet(5), status: status() } });
    const live = () => page.getByTestId('score-live').element().textContent;
    vi.advanceTimersByTime(2000);
    expect(live()).toBe('');

    await screen.rerender({ score: withNet(41035), status: status({ complete: false }) });
    vi.advanceTimersByTime(2000);
    expect(live()).toBe(''); // updating: silent

    await screen.rerender({ score: withNet(41035), status: status() });
    vi.advanceTimersByTime(900);
    expect(live()).toBe('');
    vi.advanceTimersByTime(200);
    await expect.poll(live).toBe('Net new homes 41,035, 50% of RHNA');
  });

  it('a change within the 1 s window restarts the timer', async () => {
    vi.useFakeTimers();
    await page.viewport(1280, 800);
    const screen = render(Scoreboard, { props: { score: withNet(5), status: status() } });
    const live = () => page.getByTestId('score-live').element().textContent;
    await screen.rerender({ score: withNet(6), status: status() });
    vi.advanceTimersByTime(600);
    await screen.rerender({ score: withNet(7), status: status() });
    vi.advanceTimersByTime(600);
    expect(live()).toBe('');
    vi.advanceTimersByTime(500);
    await expect.poll(live).toBe('Net new homes 7, 0.0% of RHNA');
  });
});

describe('frameLatest (§4.3: ≤ 1 render per frame)', () => {
  it('coalesces many pushes per frame into one commit of the latest value', () => {
    const frames: FrameRequestCallback[] = [];
    const raf = vi.fn((cb: FrameRequestCallback) => frames.push(cb));
    const l = frameLatest(0, raf, vi.fn());
    l.push(1);
    l.push(2);
    l.push(3);
    expect(raf).toHaveBeenCalledTimes(1);
    expect(l.current).toBe(0);
    frames.shift()!(0);
    expect(l.current).toBe(3);
    l.push(4);
    expect(raf).toHaveBeenCalledTimes(2);
    frames.shift()!(16);
    expect(l.current).toBe(4);
  });

  it('dispose cancels a pending frame', () => {
    const caf = vi.fn();
    const l = frameLatest(0, () => 7, caf);
    l.push(1);
    l.dispose();
    expect(caf).toHaveBeenCalledWith(7);
    expect(l.current).toBe(0);
  });
});
```

`frameLatest` uses `$state.raw`. The test calls it outside a component, which Svelte 5 allows for `$state` in `.svelte.ts` modules. If Svelte warns about `state_unsafe_mutation`, wrap the calls in `$effect.root`.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `./node_modules/.bin/vitest --run --project client src/lib/scoreboard/Scoreboard.svelte.spec.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `latest.svelte.ts` and `Scoreboard.svelte`** as above. Append to `index.ts`: `export { frameLatest } from './latest.svelte';`

- [ ] **Step 4: Run and confirm the tests pass**

Run: `./node_modules/.bin/vitest --run --project client src/lib/scoreboard`. Expected: PASS, with no warnings in the output.

- [ ] **Step 5: Run check and lint, then commit**

```bash
git add src/lib/scoreboard
git commit -m "feat(scoreboard): responsive shell with bottom sheet and live region"
```

---

### Task 4: BrushEditor sibling surface (additive; conductor DC ruling)

**Files:**
- Modify: `src/lib/brush/BrushEditor.svelte`
- Test: `src/lib/brush/BrushEditor.svelte.spec.ts`. Append new tests. The ONLY existing line you may edit is the assertion at :138 (`toHaveBeenCalledWith({ total: 1 })` → `toHaveBeenCalledWith({ total: 1 }, { complete: true })`).

**Interfaces:**
- Produces, per the conductor ruling (option (a), DC; item 1 per the conductor's pick B):
  1. `onscore?(s: Score, meta: { complete: boolean }): void`. The existing callback gains a second argument carrying `d.complete`, so score and completeness arrive atomically (conductor pick B).
  2. `onchunks?(c: { pending: number; failed: number }): void`. Fired at every assignment to `chunks`, meaning the chunks message (`:153`) and the restart reset in `resetChunkStatuses` (`:210`). `failed` is `chunks.failed.length`.
  3. `export function retryChunks(): void`. Forwards to `client?.retryChunks()`.
  4. `export function setSheetInset(px: number | null): void`.
     - A number overrides the computed inset: `insetPx = px; handle?.setBottomInset(px)`.
     - `null` clears the override and re-runs `applyInset()`, which re-reads `--scorebar-h`.
     - While an override is set, `applyInset` triggered by a media-query change must not clobber it. Store `let sheetInset: number | null = null`. `applyInset` uses the override if it is non-null.

JSDoc each member in the style of `oneditor`/`getEditor` (what it is for, who calls it, the contract). Update the `onscore` Props signature and JSDoc, and add `onchunks` to `Props` and to the destructuring.

Implementation sketch (exact edits):

```ts
// Props additions
    /** Latest score from the worker, with that diff's `complete` flag (I15), for the scoreboard
     *  (its "Updating…" state reads `complete`). Fired on every diff. */
    onscore?(s: Score, meta: { complete: boolean }): void;
    /** Chunk loading summary for the scoreboard (pending count, failed count), fired whenever it
     *  changes: on every `chunks` message and when a worker restart resets it. */
    onchunks?(c: { pending: number; failed: number }): void;

// helper replacing direct assignments
  function setChunks(next: { pending: number; failed: string[] }): void {
    chunks = next;
    onchunks?.({ pending: next.pending, failed: next.failed.length });
  }
// onChunks:            setChunks({ pending: c.pending, failed: [...c.failed] });
// resetChunkStatuses:  setChunks({ pending: 0, failed: [] });
// onDiff: replace `onscore?.(d.score)` with `onscore?.(d.score, { complete: d.complete })`

  let sheetInset: number | null = null;
  function applyInset(): void {
    let px = 0;
    if (sheetInset !== null) px = sheetInset;
    else if (matchMedia(NARROW).matches) { /* unchanged */ }
    insetPx = px;
    handle?.setBottomInset(px);
  }

  /**
   * Re-sends a fetch for failed parcel chunks (I15 `retryChunks`), for a sibling's Retry control
   * (the scoreboard's partial-failure row). The same request map-view's on-map chip sends.
   */
  export function retryChunks(): void {
    client?.retryChunks();
  }

  /**
   * The scoreboard's mobile sheet height while it is open (brush-tool spec line 148: the shell
   * calls setBottomInset with the sheet height when it is open). `null` when it closes: the
   * inset is recomputed from `--brushbar-h` + `--scorebar-h`.
   */
  export function setSheetInset(px: number | null): void {
    sheetInset = px;
    applyInset();
  }
```

- [ ] **Step 1: Write the failing tests.** Append a new `describe('sibling surface (scoreboard)')` to `BrushEditor.svelte.spec.ts`. Reuse the file's `setup`, `fakeWorker` and `diff` helpers. Extend `setup` **only by adding** optional handlers to `SetupOpts`, without changing existing call sites: `onchunks?`, and a `bind` that captures the component instance. In `vitest-browser-svelte`, `render(...)` returns `{ component }`, which exposes the exported functions.

```ts
describe('sibling surface (scoreboard)', () => {
  it('forwards each diff complete flag with its score', async () => {
    const { workers, onscore } = await setup();
    await expect.poll(() => workers.length).toBe(1);
    workers[0].emit({ type: 'ready', rev: 1, datasetVersion: 'fixture-0', chunkCount: 4 });
    workers[0].emit({ ...diff(2), complete: false } as SimResponse);
    expect(onscore).toHaveBeenLastCalledWith({ total: 1 }, { complete: false });
  });

  it('onchunks fires on a chunks message', async () => {
    const onchunks = vi.fn();
    const { workers } = await setup({ onchunks });
    await expect.poll(() => workers.length).toBe(1);
    workers[0].emit({ type: 'chunks', status: { a: 'error' }, pending: 2, failed: ['a'] });
    expect(onchunks).toHaveBeenLastCalledWith({ pending: 2, failed: 1 });
  });

  it('onchunks fires with zeros when a crashed worker restarts', async () => {
    const onchunks = vi.fn();
    const { workers } = await setup({ onchunks });
    await expect.poll(() => workers.length).toBe(1);
    workers[0].emit({ type: 'ready', rev: 1, datasetVersion: 'fixture-0', chunkCount: 4 });
    workers[0].emit({ type: 'chunks', status: { a: 'error' }, pending: 0, failed: ['a'] });
    // Crash: copy the exact crash trigger the existing 'fails on a crash; Retry spawns a fresh
    // worker' test in this file uses (read it first), then click Retry.
    // ... crash ...
    await click(retryButton());
    await expect.poll(() => workers.length).toBe(2);
    expect(onchunks).toHaveBeenLastCalledWith({ pending: 0, failed: 0 });
  });

  it('retryChunks() forwards to the worker', async () => {
    const { workers, posts, screen } = await setup();
    await expect.poll(() => workers.length).toBe(1);
    workers[0].emit({ type: 'ready', rev: 1, datasetVersion: 'fixture-0', chunkCount: 4 });
    (screen.component as unknown as { retryChunks(): void }).retryChunks();
    expect(posts('retryChunks')).toEqual([{ type: 'retryChunks' }]);
  });
});
```

Copy the crash trigger from the existing crash test. The implementer must read it, and must not invent a new mechanism.

For `setSheetInset`, the no-WebGL stub means there is no `SimMapHandle`. Write the test in a **new** file, `src/lib/brush/BrushEditor.inset.svelte.spec.ts`. It mocks `$lib/map/SimMap.svelte` with the existing stub, `src/lib/brush/test/sim-map-stub.ts`; read how `BrushEditor.load.svelte.spec.ts` or the restart spec use it. It spies on `setBottomInset` and asserts:
- at 375 px with `--scorebar-h: 56px` set on `documentElement`, the mount inset is `56 + 56 = 112`;
- `setSheetInset(400)` → `setBottomInset(400)`;
- after setting `--scorebar-h` to `0px`, `setSheetInset(null)` → `setBottomInset(56)`, which proves the re-read;
- a media-query `change` while the override is set keeps 400.

If the stub cannot surface the handle this way, report NEEDS_CONTEXT with what you found. Do not change the stub's existing behaviour.

- [ ] **Step 2: Run and confirm the new tests fail**

Run: `./node_modules/.bin/vitest --run --project client src/lib/brush/BrushEditor.svelte.spec.ts src/lib/brush/BrushEditor.inset.svelte.spec.ts`

- [ ] **Step 3: Implement the edits above.**

- [ ] **Step 4: Run all brush client specs.** Every existing test must stay green; only :138 is edited.

Run: `./node_modules/.bin/vitest --run --project client src/lib/brush`. Expected: PASS. Then run `git diff --stat` and confirm that no pre-existing test lines changed (only additions in the spec file).

- [ ] **Step 5: Run check and lint, then commit with its own subject**

```bash
git add src/lib/brush/BrushEditor.svelte src/lib/brush/BrushEditor.svelte.spec.ts src/lib/brush/BrushEditor.inset.svelte.spec.ts
git commit -m "feat(brush): expose chunk status, diff completeness, retryChunks and sheet inset to siblings" -m "Additive surface for the scoreboard (conductor DC ruling). The one existing-test edit: BrushEditor.svelte.spec.ts:138 now expects the new onscore meta argument."
```

---

### Task 5: Page wiring (`src/routes/+page.svelte`)

**Files:**
- Modify: `src/routes/+page.svelte`
- Test: `src/routes/page.svelte.spec.ts`. Read it first. Add one test that the scoreboard region renders on `/`, following that file's existing render pattern. If that file cannot render BrushEditor without WebGL, rely on e2e (Task 6) and record this in your report.

**Interfaces:**
- Consumes:
  - `BrushEditor`'s Task 4 members.
  - `Scoreboard` (Task 3).
  - `frameLatest` and `ScoreStatus`.
  - Page `data`: `data.manifest` (`Manifest | null`, with `datasetVersion` and `builtAt`), `data.plan.datasetVersion`, and `data.datasetVersion` (current).

Code:

```svelte
<script lang="ts">
  import { onDestroy } from 'svelte';
  import BrushEditor from '$lib/brush/BrushEditor.svelte';
  import { exposeEditorForDebug } from '$lib/brush/debug';
  import { frameLatest, type Score, type ScoreStatus } from '$lib/scoreboard';
  import Scoreboard from '$lib/scoreboard/Scoreboard.svelte';
  import { loadManifest } from '$lib/sim/manifest';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let disposeDebugEditor = () => {};
  onDestroy(() => disposeDebugEditor());
  async function reloadManifest() {
    return (await loadManifest(data.plan.datasetVersion, data.datasetVersion)).manifest;
  }

  // Scoreboard wiring (scoreboard spec §4.3/§4.4), separate from the editor/plan concern above.
  let brushEditor = $state<ReturnType<typeof BrushEditor>>();
  // Score and its diff's `complete` travel together, coalesced to ≤ 1 commit per frame.
  const latestScore = frameLatest<{ score: Score | null; complete: boolean }>({
    score: null,
    complete: true
  });
  onDestroy(() => latestScore.dispose());
  let chunkState = $state({ pending: 0, failed: 0 });
  const scoreStatus = $derived<ScoreStatus>({
    pendingChunks: chunkState.pending,
    failedChunks: chunkState.failed,
    complete: latestScore.current.complete,
    datasetVersion: data.manifest?.datasetVersion ?? data.datasetVersion,
    builtAt: data.manifest?.builtAt ?? '',
    planDatasetVersion: data.plan.datasetVersion,
    mode: 'max'
  });
</script>

<svelte:head><title>SF Housing Simulator</title></svelte:head>

<h1 class="sr-only">SF Housing Simulator</h1>
<div id="map-region" class="relative h-full">
  <BrushEditor
    bind:this={brushEditor}
    manifest={data.manifest}
    manifestError={data.manifestError}
    plan={data.plan}
    currentVersion={data.datasetVersion}
    {reloadManifest}
    oneditor={(e) => (disposeDebugEditor = exposeEditorForDebug(e))}
    onscore={(s, meta) => latestScore.push({ score: s, complete: meta.complete })}
    onchunks={(c) => (chunkState = c)}
  />
  <Scoreboard
    score={latestScore.current.score}
    status={scoreStatus}
    onretry={() => brushEditor?.retryChunks()}
    onsheetchange={(open, h) => brushEditor?.setSheetInset(open ? h : null)}
  />
</div>
```

Notes:
- `oneditor` stays untouched. Plan-sharing replaces that handler in W5c, and the scoreboard wiring sits in its own block.
- Score and `complete` arrive in one `onscore` call and are coalesced together, so they are never out of step.
- `planDatasetVersion: data.plan.datasetVersion` makes the old-plan note appear only when the plan's version differs from the manifest in use (I16 fallback).
- Scoreboard must render after BrushEditor in the DOM, so that `:root:has(.sfh-scoreboard)` already applies when BrushEditor's `onMount` runs `applyInset` (Svelte mounts the whole page DOM before running `onMount` callbacks).

- [ ] **Step 1: Write or extend the page test (or record why e2e covers it).**
- [ ] **Step 2: Implement the wiring.**
- [ ] **Step 3: Run `npm run check` (0 errors), the client specs for `src/routes`, and lint.**
- [ ] **Step 4: Commit.**

```bash
git add src/routes/+page.svelte src/routes/page.svelte.spec.ts
git commit -m "feat(scoreboard): wire the scoreboard into the editor page"
```

---

### Task 6: E2E (`e2e/scoreboard.spec.ts`) and full verification

**Files:**
- Create: `e2e/scoreboard.spec.ts`

**Interfaces:**
- Consumes: the `/` page, `window.__sfhMap` and `window.__sfhBrush` (types from `src/lib/map/debug.ts` and `src/lib/brush/debug.ts`), and `expectNoA11yViolations` from `./helpers/a11y`.
- Copy the minimal helpers you need **into this file**: `gotoEditor`, `jumpAndIdle`, `projectToPage`, `mouseDrag`, and the `FRAME`/`CHUNK` constants. Copy them from `e2e/brush.spec.ts` (read it), and do not modify brush.spec.ts. Use the same stroke coordinates its "paint: a drag paints 6 stories" test uses, so that the fixture produces buildings.

Tests. Run both Playwright projects, `chromium` at 1280 and `mobile` at 375. Use `test.skip(({ isMobile }) => …)` where a test is project-specific.

1. **Paint → nonzero net within 150 ms of pointer-up** (desktop):
   - Before the drag, install a `MutationObserver` in the page on `[data-testid="score-net"]` that records `performance.now()` at the first text change away from "0".
   - Perform `mouseDrag`.
   - Read `performance.getEntriesByName('sfh-brush-pointerup')`, which BrushController marks in the e2e build. Read `src/lib/brush/BrushController.svelte.ts` to confirm the mark name.
   - Assert `changeAt - pointerupMark.startTime <= 150`, and assert that the net text is not "0".
2. **Erase → empty state** (desktop): after painting, select the Erase tool (the brush radio "Erase") and drag over the same path. Expect net "0" and the hint "Paint a height on the map to add homes."
3. **Share link with an absent dataset version → "recalculated"**: `test.fixme('W6: needs plan-sharing share links (W5c) to load a plan whose datasetVersion is absent from R2')`.
4. **Blocked chunk → warning and Retry, Retry recovers** (desktop):
   - `page.route(CHUNK, (r) => r.abort())` before navigation, then jump to FRAME.
   - Expect the text "Some areas didn't load (1). Totals leave them out." inside the scoreboard region.
   - `page.unroute(CHUNK)`, then click the scoreboard's Retry, scoped to `getByRole('region', { name: 'Housing scoreboard' })`.
   - Expect the warning to disappear.
   - The e2e build retries chunks at 50/100/200 ms, so wait for the final failure.
5. **axe**:
   - Desktop: open both disclosures, then `expectNoA11yViolations(page)`.
   - Mobile: tap the scorebar button, wait for the "Scoreboard details" group, then `expectNoA11yViolations(page)`.
   - If an existing map-view or brush exclusion applies, read how `e2e/brush.spec.ts` calls the helper and use the same options.

Verification sequence (record every result in the report):

```bash
lsof -ti tcp:4173 | xargs kill 2>/dev/null; true
npm run check
npm run lint
npm run test:unit
npm run test:pipeline   # if tippecanoe/pmtiles are missing, record "skipped: <reason>"
npx playwright test     # all e2e, both projects
```

- [ ] **Step 1: Write `e2e/scoreboard.spec.ts`.**
- [ ] **Step 2: Kill any stale :4173 server, then run `npx playwright test e2e/scoreboard.spec.ts`.** Iterate until green. Real product bugs found here go in the report. A minimal product fix is allowed in `src/lib/scoreboard/**` and must be listed.
- [ ] **Step 3: Run the full verification sequence above.**
- [ ] **Step 4: Commit.**

```bash
git add e2e/scoreboard.spec.ts
git commit -m "test(scoreboard): e2e for score latency, states, retry and axe"
```

---

## Stage 2 acceptance (spec §7)

- §7.2: the bar is never clamped. Covered by the Task 2 overshoot test (fill 90% of a 200% track, past the tick) and Task 1 `fillPercent`.
- §7.3: the headline is net, and gross appears only in the secondary line. Task 2 test.
- §7.4: the badge and the §4.6 copy appear in every state. Task 2 test.
- §7.5: the data version, build date and source links are visible. Task 2 footnote and source-link tests.
- §7.7: at most one render per frame (Task 3 `frameLatest` plus the Task 5 wiring), and the score settles within 150 ms (Task 6 e2e 1).
- §7.8: 375 px layout (Task 3) and zero axe violations (Task 6 e2e 5).
