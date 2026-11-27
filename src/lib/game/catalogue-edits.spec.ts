// Every edit a catalogue policy's editors can write keeps it keyed to its entry (final review C1):
// lens + rounds + limits + offer together.
import { describe, expect, it } from 'vitest';
import { baselineFixture } from '$lib/sim/levers/fixtures/finance';
import miniCalibrationJson from '$lib/sim/world/fixtures/mini-calibration.json';
import { miniMarket } from '$lib/sim/world/fixtures/mini-market';
import { WINDOW_MONTHS } from '$lib/sim/timeline-client';
import type { SimPolicy } from '$lib/sim-page/policy';
import { parseCalibration } from '$lib/timelapse/model';
import type { Calibration } from '$lib/timelapse/types';
import { addPolicy } from '$lib/timeline/add';
import { project, tryWriteBack } from '$lib/timeline/lens';
import { parsePolicy4 } from '$lib/timeline/parse4';
import { DEFAULT_POLICY4, type Policy, type SimPolicy4 } from '$lib/timeline/policy4';
import { moveSpan, setFrom, setOn, type SpanRef } from '$lib/timeline/spans';
import { CATALOGUE, POLICY_KEYS, keyOf, keyOfId, type RoundEntry } from './catalogue/rounds';
import { isFixed, limitsOf, runnable, whatFixed, within, canRemove } from './limits';
import { offerThrough } from './offer';
import { NEW_GAME, type GameState } from './state';
import { upgradeV2 } from './upgrade';

const miniCal = parseCalibration(structuredClone(miniCalibrationJson) as unknown);
const cal: Calibration = {
  ...miniCal,
  market: miniMarket(),
  baselineFunding: baselineFixture().baselineFunding
};
const w = { asOf: cal.asOf, months: WINDOW_MONTHS };

const AT = '2026-11-26T00:00:00.000Z';
/** Round 4, not finished, every key editable: every policy is offered and editable, not whole. */
const state: GameState = {
  ...NEW_GAME,
  phase: 'runs',
  firstWinAt: AT,
  round: 4,
  editable: [...POLICY_KEYS].sort()
};
const limits = limitsOf(state);

const all = (doc: SimPolicy4): Policy[] => [
  ...doc.kinds.zoning,
  ...doc.kinds.permitting,
  ...doc.kinds.money
];
const policyById = (doc: SimPolicy4, id: string): Policy | undefined =>
  all(doc).find((p) => p.id === id);

/** Every number in `x` with its path, one at a time, as a changed copy of `x`. */
function bumpEachNumber<T>(x: T): T[] {
  const out: T[] = [];
  const walk = (v: unknown, set: (n: unknown) => T): void => {
    if (typeof v === 'number') {
      out.push(set(v === 0 ? 1 : v * 2));
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((e, i) => walk(e, (n) => set(v.map((f, j) => (j === i ? n : f)))));
      return;
    }
    if (typeof v === 'object' && v !== null) {
      for (const [k, e] of Object.entries(v)) walk(e, (n) => set({ ...v, [k]: n }));
    }
  };
  walk(x, (n) => n as T);
  return out;
}

/** The What edits the editors of `entry`'s policy can write, on the projection `q`. */
function whatEdits(entry: RoundEntry, q: SimPolicy): SimPolicy[] {
  if (entry.kind === 'zoning') {
    return [
      {
        ...q,
        rules: q.rules.map((r) => ({
          ...r,
          bands: r.bands.map((b) => ({ ...b, stories: b.stories + 1 }))
        }))
      },
      { ...q, rules: q.rules.map((r) => ({ ...r, bands: r.bands.slice(0, 1) })) }
    ];
  }
  if (entry.kind === 'permitting') {
    const t = q.timing.current;
    return [
      {
        ...q,
        timing: {
          ...q.timing,
          current: {
            ...t,
            edits: [{ pathway: 'discretionary', stage: 'filed', scale: 0.5, reach: 'all' }]
          }
        }
      },
      {
        ...q,
        timing: {
          ...q.timing,
          current: { ...t, routeShares: { discretionary: 20, streamlined: 50, permitOnly: 30 } }
        }
      }
    ];
  }
  // Money: every amount field (every number) of what the policy pays, one at a time.
  return bumpEachNumber(q.funding).map((funding) => ({ ...q, funding }));
}

interface Edited {
  name: string;
  doc: SimPolicy4;
  id: string;
}

/** Every edit of each of `entry`'s policies in `doc`: What, When, on and off. */
function editsOf(doc: SimPolicy4, entry: RoundEntry): Edited[] {
  const kind = entry.kind;
  const out: Edited[] = [];
  for (const p of doc.kinds[kind].filter((x) => keyOf(x) === entry.key)) {
    const ref: SpanRef = { kind, id: p.id, span: 0 };
    const q = project(doc, ref);
    whatEdits(entry, q).forEach((e, i) => {
      const r = tryWriteBack(doc, ref, e);
      if (r.refused === null && r.doc !== doc)
        out.push({ name: `${p.id} What #${i}`, doc: r.doc, id: p.id });
    });
    out.push({ name: `${p.id} on`, doc: setOn(doc, kind, p.id, true), id: p.id });
    out.push({ name: `${p.id} off`, doc: setOn(doc, kind, p.id, false), id: p.id });
    out.push({ name: `${p.id} When start`, doc: setFrom(doc, ref, 13, w), id: p.id });
    out.push({ name: `${p.id} When move`, doc: moveSpan(doc, ref, 24, w), id: p.id });
  }
  return out;
}

/** Each requirement-1 property of the policy `id` in `edited`, keyed to `entry`. */
function expectKept(edited: SimPolicy4, id: string, entry: RoundEntry, label: string): void {
  const p = policyById(edited, id);
  expect(p, `${id} is in the document`).toBeDefined();
  expect(keyOf(p!)).toBe(entry.key);
  expect(within(entry.kind, p!, limits)).toBe(true);
  expect(runnable(edited, limits).kinds[entry.kind].map((x) => x.id)).toContain(id);
  // The row keeps its name and reads Edit (not fixed, its What not summary-only, no Remove).
  expect(p!.label).toBe(label);
  expect(isFixed(p!, limits)).toBe(false);
  expect(whatFixed(p!, limits)).toBe(false);
  expect(canRemove(p!, limits)).toBe(false);
  // No second copy on the next load or after a win.
  expect(offerThrough(edited, state.round, cal, state.editable)).toBe(edited);
}

describe('a catalogue policy keeps its key through every edit', () => {
  const offered = offerThrough(DEFAULT_POLICY4, 4, cal, state.editable);

  it('the offered document has every entry, each named by its id, and parses', () => {
    for (const e of CATALOGUE) expect(all(offered).some((p) => keyOfId(p) === e.key)).toBe(true);
    expect(parsePolicy4(structuredClone(offered), { asOf: cal.asOf })).toBeTruthy();
  });

  for (const entry of CATALOGUE) {
    it(`${entry.key}: What, When, on and off`, () => {
      const edits = editsOf(offered, entry);
      if (entry.kind === 'money') {
        // The money edits change what the policy pays: the case the review found.
        expect(edits.filter((e) => e.name.includes('What')).length).toBeGreaterThan(0);
      }
      const count = all(offered).filter((p) => keyOf(p) === entry.key).length;
      for (const e of edits) {
        const label = policyById(offered, e.id)!.label;
        expectKept(e.doc, e.id, entry, label);
        expect(all(e.doc).filter((p) => keyOf(p) === entry.key).length, e.name).toBe(count);
        // Undo returns the document before the edit, redo the edited one: neither gains a copy.
        expect(offerThrough(offered, state.round, cal, state.editable)).toBe(offered);
      }
    });
  }

  it('a money edit after a win (round 2, the bond editable) keeps the bond in the run', () => {
    const r2 = limitsOf({ ...state, round: 2, editable: ['housing-bond'] });
    const doc = offerThrough(DEFAULT_POLICY4, 2, cal, ['housing-bond']);
    const bond = doc.kinds.money.find((p) => keyOf(p) === 'housing-bond')!;
    const ref: SpanRef = { kind: 'money', id: bond.id, span: 0 };
    const q = project(doc, ref);
    const edited = bumpEachNumber(q.funding)
      .map((funding) => tryWriteBack(doc, ref, { ...q, funding }))
      .find((r) => r.refused === null && r.doc !== doc)!.doc;
    const p = policyById(edited, bond.id)!;
    expect(p.preset).toBeNull();
    expect(keyOf(p)).toBe('housing-bond');
    expect(within('money', p, r2)).toBe(true);
    expect(isFixed(p, r2)).toBe(false);
    expect(runnable(edited, r2).kinds.money.map((x) => x.id)).toContain(bond.id);
    // The next load, and the win that offers round 3, add no second bond.
    expect(offerThrough(edited, 2, cal, ['housing-bond'])).toBe(edited);
    const next = offerThrough(edited, 3, cal, ['housing-bond']);
    expect(all(next).filter((x) => keyOf(x) === 'housing-bond')).toHaveLength(
      all(edited).filter((x) => keyOf(x) === 'housing-bond').length
    );
  });
});

describe('a version 2 game keeps its bought policies keyed through edits', () => {
  // A version 2 game bought nodes and added their presets with "+": addPolicy's ids
  // ("fund-u-pool-1", "timing", ...), the preset naming the entry.
  const bought = CATALOGUE.filter((e) => e.kind !== 'zoning');
  let v2doc: SimPolicy4 = DEFAULT_POLICY4;
  for (const e of bought) {
    v2doc = addPolicy(
      v2doc,
      e.kind === 'permitting'
        ? { kind: 'permitting', what: 'preset', preset: e.preset }
        : { kind: 'money', what: 'preset', preset: e.preset },
      { w, month: 1, cal }
    ).doc;
  }
  const upgraded = upgradeV2({
    v: 2,
    phase: 'runs',
    firstWinAt: AT,
    bought: Object.fromEntries(bought.map((e) => [e.key, 1])),
    rung: 2,
    met: [{ rung: 1, reachedOn: cal.asOf + 400, datasetVersion: 'fixture-0', at: AT }],
    runs: 3
  })!;
  const v2limits = limitsOf(upgraded);

  it('the upgrade makes the bought keys editable', () => {
    expect(upgraded.editable).toEqual(bought.map((e) => e.key).sort());
    expect(v2limits.whole).toBe(false);
  });

  it('the load gives each bought policy its key as its id and changes nothing else', () => {
    // Before: keyed by preset only, under addPolicy's ids.
    for (const p of all(v2doc)) expect(keyOfId(p)).toBeNull();
    const loaded = offerThrough(v2doc, upgraded.round, cal, upgraded.editable);
    const before = all(v2doc);
    const after = all(loaded).filter((p) => before.some((b) => b.spans === p.spans));
    expect(after).toHaveLength(before.length);
    after.forEach((p, i) => {
      expect(keyOfId(p)).toBe(keyOf(before[i]));
      expect({ ...p, id: before[i].id }).toEqual(before[i]);
    });
    expect(parsePolicy4(structuredClone(loaded), { asOf: cal.asOf })).toBeTruthy();
    // A second load changes nothing.
    expect(offerThrough(loaded, upgraded.round, cal, upgraded.editable)).toBe(loaded);
  });

  for (const entry of bought) {
    it(`${entry.key}: loaded, then edited, it stays keyed and runs`, () => {
      // The page loads a game's document through offerThrough.
      const loaded = offerThrough(v2doc, upgraded.round, cal, upgraded.editable);
      const mine = all(loaded).filter((p) => keyOf(p) === entry.key);
      expect(mine.length).toBeGreaterThan(0);
      const edits = editsOf(loaded, entry);
      expect(edits.filter((e) => e.name.includes('What')).length).toBeGreaterThan(0);
      for (const e of edits) {
        const p = policyById(e.doc, e.id)!;
        expect(keyOf(p), e.name).toBe(entry.key);
        expect(p.label, e.name).toBe(policyById(loaded, e.id)!.label);
        expect(isFixed(p, v2limits), e.name).toBe(false);
        expect(whatFixed(p, v2limits), e.name).toBe(false);
        expect(within(entry.kind, p, v2limits), e.name).toBe(true);
        expect(runnable(e.doc, v2limits).kinds[entry.kind].map((x) => x.id)).toContain(e.id);
        expect(offerThrough(e.doc, upgraded.round, cal, upgraded.editable), e.name).toBe(e.doc);
      }
    });
  }
});
