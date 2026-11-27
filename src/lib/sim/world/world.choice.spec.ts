// The developer's choice at a start (building-choice Task 9): the option the size draw picks,
// a second start on a demolished lot, a second cost step, and a lot no option gains on.
import { describe, expect, it } from 'vitest';
import { NULL_CAP } from '$lib/data/policy-codec';
import { stockTable } from '$lib/sim/levers/layers';
import { parcelsView } from '$lib/sim/levers/view';
import { allowedCount, optionHomes } from '$lib/sim/choice/choose';
import type { ChoiceModel, PriceStep } from '$lib/sim/choice/types';
import { precomputeOf } from '$lib/sim/world/input/build';
import type { SimInput } from '$lib/sim/world/input/types';
import { MINI_NO_GAIN_ID } from './fixtures/mini-parcels';
import { miniPolicy } from './fixtures/mini-policy';
import { miniCity } from './fixtures/mini-parcels';
import { monthFirstDay } from './months';
import { staticsOf } from './statics';
import { miniInput } from './test/mini';
import { horizonMonth, Recorder, runWorld, SEEDS } from './test/run';
import { changingAt, frameOf, oneFrame } from './test/timeline';
import { ORIGIN_SIM, type World } from './types';

const input = miniInput();
const t = input.options;

/**
 * A world on `o.input`'s own view. With `stepFrom`, frames from that month read cost step 1, as a
 * compile sets `choiceStep` from the step in force on each month's first day.
 */
function runMini(o: { months: number; seed?: number; input?: SimInput; stepFrom?: number }) {
  const inp = o.input ?? input;
  const f = frameOf(inp);
  const timeline =
    o.stepFrom === undefined
      ? oneFrame(f)
      : changingAt(o.stepFrom, f, { ...f, id: 1, choiceStep: 1 }, null);
  const rec = new Recorder();
  const w = runWorld(staticsOf(inp), timeline, o.seed ?? 1, o.months, rec);
  return { w, rec };
}

/** Simulated rows in row order: lot, start day, option index, units, stories, type. */
function starts(w: World) {
  const p = w.projects;
  const out: { lot: number; day: number; k: number; units: number; stories: number }[] = [];
  for (let r = 0; r < p.n; r++) {
    if (p.origin[r] !== ORIGIN_SIM) continue;
    out.push({
      lot: p.src[r],
      day: p.revDay[firstRev(w, r)],
      k: p.level[r],
      units: p.revUnits[firstRev(w, r)],
      stories: p.revStories[firstRev(w, r)]
    });
  }
  return out;
}

function firstRev(w: World, row: number): number {
  const p = w.projects;
  let at = p.revLast[row];
  while (p.revPrev[at] >= 0) at = p.revPrev[at];
  return at;
}

describe("a start chooses among the lot's options", () => {
  it('starts the option the size draw picks and records its type and stories', () => {
    const { w } = runMini({ months: horizonMonth(input.asOf) });
    const p = w.projects;
    let seen = 0;
    for (let r = 0; r < p.n; r++) {
      if (p.origin[r] !== ORIGIN_SIM || p.funded[r] === 1) continue;
      const lot = p.src[r];
      // the row's option as last revised (a revision moves within the type)
      const j = t.offset[lot] + p.level[r];
      expect(p.revStories[p.revLast[r]]).toBe(t.stories[j]);
      expect(p.btype[r]).toBe(t.type[j]);
      expect(p.level[r]).toBeLessThan(allowedCount(t, lot, input.parcels.envelopeStories[lot]));
      seen++;
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('rebuilds the choice row against 0 existing on a demolished lot', () => {
    let checked = 0;
    for (const seed of SEEDS) {
      const { w } = runMini({ months: horizonMonth(input.asOf), seed });
      const p = w.projects;
      const byLot = new Map<number, number[]>();
      for (let r = 0; r < p.n; r++) {
        if (p.origin[r] !== ORIGIN_SIM || p.funded[r] === 1) continue;
        byLot.set(p.src[r], [...(byLot.get(p.src[r]) ?? []), r]);
      }
      for (const [lot, rows] of byLot) {
        for (const r of rows.slice(1)) {
          if (p.existing[r] !== 0 || input.parcels.existingUnits[lot] === 0) continue;
          const cap = input.parcels.fzpCap[lot];
          const j = t.offset[lot] + p.level[r];
          expect(p.revUnits[firstRev(w, r)]).toBe(
            optionHomes(t, j, cap === NULL_CAP ? null : cap, 0)
          );
          checked++;
        }
      }
      if (checked > 0) break;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('changes the choice for starts after a second cost step only', () => {
    const months = 120;
    const D = monthFirstDay(input.asOf, 60);
    const choice = input.calibration.choice!;
    const step0 = choice.prices[0];
    const anchors = structuredClone(step0.value.anchors);
    for (const id of ['C', 'D'] as const) anchors[id].costPerHome *= 0.7;
    const cheaperTypeI: PriceStep = { ...step0.value, anchors };
    const two: ChoiceModel = { ...choice, prices: [step0, { from: D, value: cheaperTypeI }] };
    const twoInput: SimInput = {
      ...input,
      calibration: { ...input.calibration, choice: two }
    };
    const before = (s: ReturnType<typeof starts>) => s.filter((x) => x.day < D);
    const after = (s: ReturnType<typeof starts>) => s.filter((x) => x.day >= D);
    let differs = false;
    for (const seed of SEEDS) {
      const one = starts(runMini({ months, seed }).w);
      const other = starts(runMini({ months, seed, input: twoInput, stepFrom: 60 }).w);
      expect(before(other)).toEqual(before(one));
      if (JSON.stringify(after(other)) !== JSON.stringify(after(one))) differs = true;
    }
    expect(differs).toBe(true);
  });

  it('marks a lot whose cap is at or below existing homes as not hostable', () => {
    const city = miniCity();
    const layers = { parcels: input.parcels, policy: miniPolicy(city), options: t };
    const lot = input.parcels.index.get(MINI_NO_GAIN_ID)!;
    const table = stockTable(layers, 'fzp');
    expect(table.cap[lot]).toBeLessThanOrEqual(input.parcels.existingUnits[lot]);
    const parcels = parcelsView(input.parcels, table, input.parcels.localProgram, t);
    expect(parcels.hostable[lot]).toBe(0);
    const pre = precomputeOf({ ...input, parcels });
    expect(pre.hazard[lot]).toBe(0);
    expect(pre.logit[lot]).toBe(-Infinity);
  });
});
