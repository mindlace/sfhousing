// Plan 2 Task 9: the time-switched envelope (ruling 1, the law switch). From `lawSwitch.day` a
// second parcels view is in force, and a project keeps the regime of the month it initiated in.
import { describe, expect, it } from 'vitest';
import type { ParcelId } from '$lib/data/parcel';
import { parseCalibration } from '$lib/timelapse/model';
import { parseProjectsFile } from '$lib/timelapse/projects';
import { MONTH_DAYS, type Day } from '$lib/timelapse/time';
import { stockTable, type EnvelopeTable } from '../levers/layers';
import { CURRENT_LAW_SWITCH } from '../levers/types';
import { parcelsView } from '../levers/view';
import miniCalibrationJson from './fixtures/mini-calibration.json';
import { miniCity } from './fixtures/mini-parcels';
import { miniPolicy } from './fixtures/mini-policy';
import { MINI_AS_OF, MINI_HORIZON, miniProjectsJson } from './fixtures/mini-projects';
import { buildSimInput, precomputeOf, switchMonth } from './input';
import { monthsOf, netOf, shownSeries } from './score';
import { simulateDetailed, simulateNet } from './simulate';
import type { Schedule, SimInput } from './types';

const H = MINI_HORIZON;
const DAY = CURRENT_LAW_SWITCH.day;
const seeds = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

function setup() {
  const city = miniCity();
  const base = buildSimInput({
    parcels: city.parcels,
    projects: parseProjectsFile(miniProjectsJson(), { onInvalid() {} }),
    calibration: parseCalibration(structuredClone(miniCalibrationJson) as unknown)
  });
  const fzp = stockTable({ parcels: city.parcels, policy: miniPolicy(city) }, 'fzp');
  return { base, fzp };
}

/** A fresh copy of `t` (its columns are the decoded ones and must not be mutated). */
const copyOf = (t: EnvelopeTable): EnvelopeTable => ({
  count: t.count,
  stories: t.stories.slice(),
  cap: t.cap.slice(),
  yield: t.yield.slice(),
  hostable: t.hostable.slice()
});

/** Candidate rows no in-flight project names, highest hazard first. */
function freeCandidates(input: SimInput): number[] {
  const held = new Set<ParcelId>();
  for (const p of input.projects) {
    for (const id of p.parcelIds) held.add(id);
    for (const ph of p.phases ?? []) for (const id of ph.parcelIds) held.add(id);
  }
  const pre = precomputeOf(input);
  return Array.from(pre.candidates)
    .filter((i) => !held.has(input.parcels.id[i]))
    .sort((a, b) => pre.hazard[b] - pre.hazard[a]);
}

/** The simulated schedules on lot `id`, by k, with the day each was at risk from. */
function onLot(ss: Schedule[], id: ParcelId, asOf: Day): { s: Schedule; r: Day }[] {
  const mine = ss
    .filter((s) => s.origin === 'simulated' && s.parcelIds[0] === id)
    .sort((a, b) => Number(a.projectId.split(':')[2]) - Number(b.projectId.split(':')[2]));
  let r = asOf;
  return mine.map((s) => {
    const out = { s, r };
    if (s.end.kind === 'exit') r = s.end.day;
    return out;
  });
}

/** The initiation month T (from `r`) that contains `d`. */
function monthOf(r: Day, d: Day): number {
  let T = 1;
  while (r + 1 + Math.floor(T * MONTH_DAYS) <= d) T++;
  return T;
}

const startDay = (s: Schedule): Day => s.revisions[0].day;
const afterRegime = (r: Day, s: Schedule) => monthOf(r, startDay(s)) > switchMonth(r, DAY);

describe('switchMonth', () => {
  it('counts the initiation months from r that start before day', () => {
    const r = MINI_AS_OF;
    const start = (T: number) => r + 1 + Math.floor((T - 1) * MONTH_DAYS);
    const T0 = switchMonth(r, DAY);
    expect(start(T0)).toBeLessThan(DAY);
    expect(start(T0 + 1)).toBeGreaterThanOrEqual(DAY);
    expect(switchMonth(r, r + 1)).toBe(0);
    expect(switchMonth(r, r + 2)).toBe(1);
    expect(switchMonth(DAY, DAY)).toBe(0);
  });
});

describe('engine law switch', () => {
  it('an after-view equal to the base gives the unswitched run, seeds 1-20', () => {
    const { base, fzp } = setup();
    const view = parcelsView(base.parcels, fzp, base.parcels.localProgram);
    const input: SimInput = { ...base, lawSwitch: { day: DAY, parcels: view } };
    let sims = 0;
    for (const seed of seeds(20)) {
      const was = simulateDetailed(base, seed, H);
      expect(simulateDetailed(input, seed, H)).toEqual(was);
      sims += was.schedules.filter((s) => s.origin === 'simulated').length;
    }
    expect(sims).toBeGreaterThan(0);
  });

  it('keeps each lot to the months its regime hosts it, seeds 1-50', () => {
    const { base, fzp } = setup();
    const [onlyAfter, onlyBefore] = freeCandidates(base);
    const before = copyOf(fzp);
    const after = copyOf(fzp);
    before.hostable[onlyAfter] = 0;
    after.hostable[onlyBefore] = 0;
    const lp = base.parcels.localProgram;
    const plan: SimInput = {
      ...base,
      parcels: parcelsView(base.parcels, before, lp),
      lawSwitch: { day: DAY, parcels: parcelsView(base.parcels, after, lp) }
    };
    const idA = base.parcels.id[onlyAfter];
    const idB = base.parcels.id[onlyBefore];
    let initiatedA = 0;
    let initiatedB = 0;
    for (const seed of seeds(50)) {
      const ss = simulateDetailed(plan, seed, H).schedules;
      for (const { s } of onLot(ss, idA, plan.asOf)) {
        expect(startDay(s)).toBeGreaterThanOrEqual(DAY);
        initiatedA++;
      }
      for (const { s, r } of onLot(ss, idB, plan.asOf)) {
        expect(monthOf(r, startDay(s))).toBeLessThanOrEqual(switchMonth(r, DAY));
        initiatedB++;
      }
    }
    expect(initiatedA).toBeGreaterThan(0);
    expect(initiatedB).toBeGreaterThan(0);
  });

  it('takes a project’s units from the yields of the regime it initiated in', () => {
    const { base, fzp } = setup();
    const [row] = freeCandidates(base);
    const F = base.parcels.fillLevels.length;
    const after = copyOf(fzp);
    for (let f = 0; f < F; f++) {
      const y = fzp.yield[row * F + f];
      after.yield[row * F + f] = y > 0 ? y + 1000 : 0;
    }
    const input: SimInput = {
      ...base,
      lawSwitch: {
        day: DAY,
        parcels: parcelsView(base.parcels, after, base.parcels.localProgram)
      }
    };
    const yieldsOf = (t: EnvelopeTable) => Array.from(t.yield.subarray(row * F, row * F + F));
    const was = yieldsOf(fzp);
    const now = yieldsOf(after);
    let pre = 0;
    let post = 0;
    for (const seed of seeds(50)) {
      const ss = simulateDetailed(input, seed, H).schedules;
      for (const { s, r } of onLot(ss, base.parcels.id[row], input.asOf)) {
        const units = s.revisions[0].units;
        if (afterRegime(r, s)) {
          expect(now).toContain(units);
          expect(units).toBeGreaterThanOrEqual(1000);
          post++;
        } else {
          expect(was).toContain(units);
          expect(units).toBeLessThan(1000);
          pre++;
        }
      }
    }
    expect(pre).toBeGreaterThan(0);
    expect(post).toBeGreaterThan(0);
  });

  it('simulateNet equals netOf(shownSeries(simulateDetailed)) with a switch, seeds 1-20', () => {
    const { base, fzp } = setup();
    const after = copyOf(fzp);
    const F = base.parcels.fillLevels.length;
    for (let i = 0; i < after.count; i++) {
      for (let f = 0; f < F; f++) {
        const y = after.yield[i * F + f];
        after.yield[i * F + f] = y > 0 ? 2 * y : 0;
      }
    }
    const input: SimInput = {
      ...base,
      lawSwitch: {
        day: DAY,
        parcels: parcelsView(base.parcels, after, base.parcels.localProgram)
      }
    };
    const months = monthsOf(input.asOf, H);
    let differs = false;
    for (const seed of seeds(20)) {
      const net = simulateNet(input, seed, H, months);
      const detailed = simulateDetailed(input, seed, H);
      expect(net).toEqual(netOf(shownSeries(detailed, input.asOf, H, months)));
      const plain = simulateNet(base, seed, H, months);
      if (plain.completedNet[months.length - 1] !== net.completedNet[months.length - 1]) {
        differs = true;
      }
    }
    expect(differs).toBe(true);
  });

  it('throws RangeError when the switch day is not after asOf', () => {
    const { base } = setup();
    for (const day of [base.asOf, base.asOf - 1]) {
      const input: SimInput = { ...base, lawSwitch: { day, parcels: base.parcels } };
      expect(() => simulateDetailed(input, 1, H)).toThrow(RangeError);
    }
  });
});
