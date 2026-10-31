import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { wcagContrast, wcagLuminance } from 'culori';
import { DAYS, SLOT, timelineSmall } from '../fixtures/timeline-small';
import { timelineLookups } from '../fixtures/timeline-lookups';
import { TOKENS, hexToRgba, type RGBA } from '../palette';
import type { TimedPackedCell } from '../types';
import { BAR_SEGMENTS, barColor, barSizePx, buildBars, evalBar, rampColor } from './bars';
import {
  BAR_MIN_ZOOM,
  BAR_TOP_GAP_M,
  COMPLETE_FADE_DAYS,
  COMPLETE_HOLD_DAYS,
  DYING_FADE_DAYS,
  DYING_HOLD_DAYS,
  FLOOR_CAP
} from './constants';
import { chanceRow } from './lookups';
import type { BarAttrs, TimelineLookups } from './types';
import { DYING_DAYS, MONTH_DAYS, OPEN_DAY, monthsIn } from '$lib/timelapse/time';
import { PATHWAYS, STAGE_ORDER } from '$lib/timelapse/types';

type SlotKey = keyof typeof SLOT;
const L = timelineLookups;
const BARS = buildBars(timelineSmall.cells, L);
const barsOf = (key: SlotKey, bars = BARS) =>
  bars.filter((b) => b.projectId === SLOT[key].projectId);
const bar = (key: SlotKey) => barsOf(key)[0];
const cellOf = (key: SlotKey) => timelineSmall.cells.find((c) => c.cellId === SLOT[key].cellId)!;
/** A street-zoom view where every bar's zoom alpha is 1. */
const Z = 16;

/** (key)'s cell with the slot's preApplication entered on `day` (no fixture permitOnly has one). */
function withPpa(key: SlotKey, day: number): TimedPackedCell {
  const c = structuredClone(cellOf(key));
  const s = c.slotProjectIds.indexOf(SLOT[key].projectId);
  c.slotStages[STAGE_ORDER.length * s + STAGE_ORDER.indexOf('preApplication')] = day;
  return c;
}

describe('BAR_SEGMENTS and segment lists', () => {
  it('lists the §4.4.2 segments without preApplication', () => {
    expect(BAR_SEGMENTS.discretionary).toEqual([
      'filed',
      'entitled',
      'permitFiled',
      'permitIssued',
      'construction'
    ]);
    expect(BAR_SEGMENTS.streamlined).toEqual(BAR_SEGMENTS.discretionary);
    expect(BAR_SEGMENTS.permitOnly).toEqual(['permitFiled', 'permitIssued', 'construction']);
  });
  it('has 6 segments for discretionary with a PPA and 5 without', () => {
    expect(bar('a').segCount).toBe(6);
    expect(bar('a').segRow).toEqual([0, 1, 2, 3, 4, 5]);
    for (const k of ['e', 'g', 'i1'] as const) expect(bar(k).segCount, k).toBe(5);
    expect(bar('f').segCount).toBe(5); // streamlined, no PPA
  });
  it('has 4 segments for permitOnly with a PPA and 3 without', () => {
    expect(bar('c').segCount).toBe(3);
    const po = PATHWAYS.indexOf('permitOnly');
    expect(bar('c').segRow).toEqual([3, 4, 5].map((j) => po * 6 + j));
    const ppa = DAYS.c.permitFiled - 60;
    const [b] = barsOf('c', buildBars([withPpa('c', ppa)], L));
    expect(b.segCount).toBe(4);
    expect(b.segEntry[0]).toBe(ppa);
    expect(b.segRow[0]).toBe(chanceRow(po, 'preApplication', 0));
    // from = max(ghostFrom, revision day): the injected PPA predates (c)'s first revision.
    expect(b.from).toBe(Math.max(ppa, DAYS.c.rev0));
  });
  it('carries segCount-long per-segment arrays and typical days', () => {
    for (const b of BARS) {
      expect(b.segEntry).toHaveLength(b.segCount);
      expect(b.segTypicalDays).toHaveLength(b.segCount);
      expect(b.segRow).toHaveLength(b.segCount);
    }
    expect(bar('a').segTypicalDays[1]).toBe(L.typicalMonths.discretionary.filed! * MONTH_DAYS);
    // streamlined.permitFiled is missing from the lookups: OPEN_DAY, so its fill stays at 0.
    expect(bar('f').segTypicalDays[2]).toBe(OPEN_DAY);
  });
});

describe('buildBars', () => {
  it('builds one bar per (slot, revision), with minZoom at the gate', () => {
    expect(BARS).toHaveLength(Object.keys(SLOT).length + 1); // (d) has two revisions
    expect(barsOf('d')).toHaveLength(2);
    for (const b of BARS) expect(b.minZoom).toBe(BAR_MIN_ZOOM);
    for (const k of Object.keys(SLOT) as SlotKey[]) expect(bar(k).parcelId).toBe(SLOT[k].parcelId);
  });
  it('windows each revision from max(ghostFrom, revision day) to the next revision', () => {
    const [d0, d1] = barsOf('d');
    expect([d0.from, d0.to]).toEqual([DAYS.d.filed, DAYS.d.rev1]);
    expect([d1.from, d1.to]).toEqual([DAYS.d.rev1, OPEN_DAY]);
  });
  it('ends exits with the ghost, completions after hold + fade, open bars never', () => {
    const b = bar('b');
    expect([b.endKind, b.endDay, b.completeDay]).toEqual([2, DAYS.b.end, OPEN_DAY]);
    expect(b.barEnd).toBe(DAYS.b.end + DYING_DAYS);
    expect(b.to).toBe(b.barEnd);
    const a = bar('a');
    expect([a.endKind, a.endDay, a.completeDay]).toEqual([1, DAYS.a.end, DAYS.a.complete]);
    expect(a.barEnd).toBe(DAYS.a.complete + COMPLETE_HOLD_DAYS + COMPLETE_FADE_DAYS);
    const c = bar('c');
    expect([c.endKind, c.endDay, c.completeDay, c.barEnd]).toEqual([
      0,
      OPEN_DAY,
      OPEN_DAY,
      OPEN_DAY
    ]);
  });
  it('anchors at the revision bbox centre, 2 m above its highest part', () => {
    const cell = cellOf('d');
    const s = cell.slotProjectIds.indexOf(SLOT.d.projectId);
    barsOf('d').forEach((b, i) => {
      const rev = [DAYS.d.rev0, DAYS.d.rev1][i];
      let [x0, y0, x1, y1, top] = [Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let k = 0; k < cell.partCount; k++) {
        if (cell.partSlot[k] !== s || cell.partWindow[2 * k] !== rev) continue;
        top = Math.max(top, cell.partTopM[k]);
        for (let v = cell.startIndices[k]; v < cell.startIndices[k + 1]; v++) {
          [x0, x1] = [Math.min(x0, cell.positions[2 * v]), Math.max(x1, cell.positions[2 * v])];
          const y = cell.positions[2 * v + 1];
          [y0, y1] = [Math.min(y0, y), Math.max(y1, y)];
        }
      }
      expect(b.anchor[0]).toBeCloseTo((x0 + x1) / 2, 12);
      expect(b.anchor[1]).toBeCloseTo((y0 + y1) / 2, 12);
      expect(b.anchor[2]).toBe(top + BAR_TOP_GAP_M);
    });
    // The downsized revision's bar sits lower.
    expect(barsOf('d')[1].anchor[2]).toBeLessThan(barsOf('d')[0].anchor[2]);
  });
  it('takes units from the final revision and validates each cell', () => {
    const cell = cellOf('d');
    const s = cell.slotProjectIds.indexOf(SLOT.d.projectId);
    for (const b of barsOf('d')) expect(b.units).toBe(cell.parcelMeta[4 * s]);
    const bad = { ...cellOf('a'), slotPathway: new Uint8Array(0) };
    expect(() => buildBars([bad], L)).toThrow(TypeError);
  });
});

describe('evalBar visibility and alpha', () => {
  it('is hidden before ghostFrom and visible from it', () => {
    const a = bar('a');
    expect(evalBar(a, L, DAYS.a.preApplication - 1, Z).visible).toBe(false);
    expect(evalBar(a, L, DAYS.a.preApplication, Z)).toMatchObject({ visible: true, alpha: 1 });
    expect(evalBar(bar('f'), L, DAYS.start, Z).visible).toBe(false);
  });
  it('swaps revision bars exactly at the revision day', () => {
    const [d0, d1] = barsOf('d');
    expect(evalBar(d0, L, DAYS.d.rev1 - 1, Z).visible).toBe(true);
    expect(evalBar(d1, L, DAYS.d.rev1 - 1, Z).visible).toBe(false);
    expect(evalBar(d0, L, DAYS.d.rev1, Z).visible).toBe(false);
    expect(evalBar(d1, L, DAYS.d.rev1, Z).visible).toBe(true);
  });
  it('ramps zoom alpha over the 0.5 zoom below max(15, minZoom)', () => {
    const a = bar('a');
    const t = DAYS.a.filed;
    expect(evalBar(a, L, t, 14.5).visible).toBe(false);
    expect(evalBar(a, L, t, 14.75)).toMatchObject({ visible: true, alpha: 0.5 });
    expect(evalBar(a, L, t, 15).alpha).toBe(1);
    expect(evalBar(a, L, t, 21).alpha).toBe(1);
    const m = { ...a, minZoom: 16 };
    expect(evalBar(m, L, t, 15.5).visible).toBe(false);
    expect(evalBar(m, L, t, 15.75).alpha).toBe(0.5);
    expect(evalBar({ ...a, minZoom: 12 }, L, t, 14.5).visible).toBe(false);
  });
  it('an exited bar is dead with no chance, red for the hold, then fades with the ghost', () => {
    const b = bar('b');
    const end = DAYS.b.end;
    expect(evalBar(b, L, end - 1, Z)).toMatchObject({ dead: false, alpha: 1 });
    expect(evalBar(b, L, end - 1, Z).chance).not.toBeNull();
    const atEnd = evalBar(b, L, end, Z);
    expect(atEnd).toMatchObject({ visible: true, dead: true, chance: null, alpha: 1 });
    expect(evalBar(b, L, end + DYING_HOLD_DAYS - 1, Z).alpha).toBe(1);
    expect(evalBar(b, L, end + DYING_HOLD_DAYS + DYING_FADE_DAYS / 2, Z).alpha).toBe(0.5);
    expect(evalBar(b, L, end + DYING_DAYS - 1, Z).visible).toBe(true);
    expect(evalBar(b, L, end + DYING_DAYS, Z).visible).toBe(false);
  });
  it('freezes the fill at the exit day ((e) dies 400 days into construction)', () => {
    const e = bar('e');
    // Construction is segment 4 of 5; 400 days is below the cap, so the frozen value is exact.
    const within = (DAYS.e.end - DAYS.e.construction) / MONTH_DAYS;
    const frozen = (4 + within / L.typicalMonths.discretionary.construction!) / 5;
    expect(within / L.typicalMonths.discretionary.construction!).toBeLessThan(FLOOR_CAP);
    expect(evalBar(e, L, DAYS.e.end - 1, Z).fill).toBeLessThan(frozen);
    expect(evalBar(e, L, DAYS.e.end, Z).fill).toBeCloseTo(frozen, 12);
    expect(evalBar(e, L, DAYS.e.end + 100, Z).fill).toBeCloseTo(frozen, 12);
    expect(evalBar(e, L, DAYS.e.end + 200, Z).fill).toBeCloseTo(frozen, 12);
  });
  it('a completed bar is full with no chance, holds 90 days and fades over 90', () => {
    const a = bar('a');
    const done = DAYS.a.complete;
    expect(evalBar(a, L, done, Z)).toMatchObject({ fill: 1, chance: null, dead: false, alpha: 1 });
    expect(evalBar(a, L, done + COMPLETE_HOLD_DAYS - 1, Z).alpha).toBe(1);
    expect(evalBar(a, L, done + COMPLETE_HOLD_DAYS + COMPLETE_FADE_DAYS / 2, Z).alpha).toBe(0.5);
    expect(evalBar(a, L, done + COMPLETE_HOLD_DAYS + COMPLETE_FADE_DAYS, Z).visible).toBe(false);
  });
  it('an open bar never ends', () => {
    expect(evalBar(bar('c'), L, DAYS.horizon, Z)).toMatchObject({ visible: true, alpha: 1 });
  });
});

describe('evalBar fill (§4.4.2)', () => {
  it('fills within the current segment by elapsed months over typical months', () => {
    const a = bar('a');
    const t = DAYS.a.filed + 30;
    const within = 30 / MONTH_DAYS / L.typicalMonths.discretionary.filed!;
    expect(evalBar(a, L, t, Z).fill).toBeCloseTo((1 + within) / 6, 12);
    expect(evalBar(a, L, DAYS.a.entitled, Z).fill).toBeCloseTo(2 / 6, 12);
  });
  it('caps the within-segment fill at 0.9 until the next stage starts', () => {
    const a = bar('a');
    // a stays in `entitled` longer than 0.9 · typical: the cap applies the day before permitFiled.
    expect((DAYS.a.permitFiled - 1 - DAYS.a.entitled) / MONTH_DAYS).toBeGreaterThan(
      FLOOR_CAP * L.typicalMonths.discretionary.entitled!
    );
    expect(evalBar(a, L, DAYS.a.permitFiled - 1, Z).fill).toBeCloseTo((2 + FLOOR_CAP) / 6, 12);
    expect(evalBar(a, L, DAYS.a.complete - 1, Z).fill).toBeCloseTo((5 + FLOOR_CAP) / 6, 12);
    expect(evalBar(a, L, DAYS.a.complete, Z).fill).toBe(1);
  });
  it('(g) counts the skipped `entitled` as passed once permitFiled starts', () => {
    const g = bar('g');
    expect(g.segEntry).toEqual([
      DAYS.g.filed,
      DAYS.g.permitFiled,
      DAYS.g.permitFiled,
      DAYS.g.permitIssued,
      DAYS.g.construction
    ]);
    const before = (DAYS.g.permitFiled - 1 - DAYS.g.filed) / MONTH_DAYS;
    const w = Math.min(before / L.typicalMonths.discretionary.filed!, FLOOR_CAP);
    expect(evalBar(g, L, DAYS.g.permitFiled - 1, Z).fill).toBeCloseTo(w / 5, 12);
    expect(evalBar(g, L, DAYS.g.permitFiled, Z).fill).toBeCloseTo(2 / 5, 12);
    const chance = evalBar(g, L, DAYS.g.permitFiled, Z).chance;
    expect(chance).toBe(L.chance.discretionary.permitFiled![0]);
  });
  it('a stage with no typical duration stays at its segment start', () => {
    const f = bar('f');
    expect(evalBar(f, L, DAYS.f.permitFiled + 200, Z).fill).toBeCloseTo(2 / 5, 12);
  });
  it('a 0-month typical duration gives a finite fill on entry and the cap the next day', () => {
    const zero: typeof L = {
      ...L,
      typicalMonths: { ...L.typicalMonths, discretionary: { ...L.typicalMonths.discretionary } }
    };
    zero.typicalMonths.discretionary.filed = 0;
    const a = barsOf('a', buildBars(timelineSmall.cells, zero))[0];
    expect(a.segTypicalDays[1]).toBe(1); // typicalDays' 1-day floor
    const onEntry = evalBar(a, zero, DAYS.a.filed, Z).fill;
    expect(Number.isFinite(onEntry)).toBe(true);
    expect(onEntry).toBeCloseTo(1 / 6, 12);
    expect(evalBar(a, zero, DAYS.a.filed + 1, Z).fill).toBeCloseTo((1 + FLOOR_CAP) / 6, 12);
  });
  it('property: fill never reaches a segment before it is entered, nor 1 before completion', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: BARS.length - 1 }),
        fc.integer({ min: DAYS.start, max: DAYS.horizon }),
        (i, t) => {
          const b = BARS[i];
          const e = evalBar(b, L, t, Z);
          if (!e.visible) return;
          const tEff = b.endKind === 2 ? Math.min(t, b.endDay) : t;
          for (let j = 0; j < b.segCount; j++)
            if (b.segEntry[j] > tEff) expect(e.fill).toBeLessThan(j / b.segCount);
          if (t < b.completeDay) expect(e.fill).toBeLessThan(1);
          else expect(e.fill).toBe(1);
          expect(e.fill).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('evalBar chance (§4.4.3)', () => {
  it('indexes by monthsIn at the boundary days entry + k·MONTH_DAYS, clamped to 240', () => {
    const d1 = barsOf('d')[1]; // open, sits in permitIssued forever
    const entry = DAYS.d.permitIssued;
    expect(d1.segEntry[3]).toBe(entry);
    const row = L.chance.discretionary.permitIssued!;
    // Observed month index per k: entry + k·MONTH_DAYS rounds below the boundary in doubles at
    // k = 1 and 240, so monthsIn gives k − 1 there; 300 clamps to the table's last entry, 240.
    const index: Record<number, number> = { 0: 0, 1: 0, 240: 239, 300: 240 };
    for (const k of [0, 1, 240, 300]) {
      const t = entry + k * MONTH_DAYS;
      expect(Math.min(monthsIn(entry, t), 240), `k=${k}`).toBe(index[k]);
      expect(evalBar(d1, L, t, Z).chance, `k=${k}`).toBe(row[index[k]]);
      if (k > 0) {
        const before = evalBar(d1, L, entry + k * MONTH_DAYS - 1, Z).chance;
        expect(before, `k=${k} − 1 day`).toBe(row[Math.min(k - 1, 240)]);
      }
    }
    expect(evalBar(d1, L, entry + 300 * MONTH_DAYS, Z).chance).toBe(row[240]);
  });
  it('reads chance 0 from an absent row instead of throwing (bad data)', () => {
    expect(L.chance.streamlined.preApplication).toBeUndefined();
    const f = bar('f');
    const ppa = DAYS.f.filed - 100;
    const b: BarAttrs = {
      ...f,
      from: ppa,
      segCount: 6,
      segEntry: [ppa, ...f.segEntry],
      segTypicalDays: [4 * MONTH_DAYS, ...f.segTypicalDays],
      segRow: [chanceRow(PATHWAYS.indexOf('streamlined'), 'preApplication', 0), ...f.segRow]
    };
    const e = evalBar(b, L, ppa + 50, Z);
    expect(e).toMatchObject({ visible: true, chance: 0, dead: false });
  });
});

describe('cohorts', () => {
  /** (key)'s cell with that slot in flight (slotCohort 1). */
  function inFlightCell(key: SlotKey): TimedPackedCell {
    const c = structuredClone(cellOf(key));
    c.slotCohort[c.slotProjectIds.indexOf(SLOT[key].projectId)] = 1;
    return c;
  }
  /** In-flight lookups: discretionary filed is 2 months typical, its chance a flat 0.9. */
  const IN_FLIGHT: TimelineLookups = {
    chance: {
      ...L.chance,
      discretionary: { ...L.chance.discretionary, filed: new Float32Array(241).fill(0.9) }
    },
    typicalMonths: {
      ...L.typicalMonths,
      discretionary: { ...L.typicalMonths.discretionary, filed: 2 }
    }
  };
  const BOTH: TimelineLookups = { ...L, inFlight: IN_FLIGHT };

  it('cohort rows follow slotCohort', () => {
    const fresh = buildBars([cellOf('a')], BOTH).filter((b) => b.projectId === SLOT.a.projectId);
    const flight = buildBars([inFlightCell('a')], BOTH).filter(
      (b) => b.projectId === SLOT.a.projectId
    );
    expect(fresh.length).toBeGreaterThan(0);
    expect(flight.length).toBe(fresh.length);
    for (const b of fresh) for (const r of b.segRow) expect(r).toBeLessThan(18);
    for (const b of flight) for (const r of b.segRow) expect(r).toBeGreaterThanOrEqual(18);
    expect(flight[0].segRow).toEqual(fresh[0].segRow.map((r) => r + 18));
    // the fill reads the in-flight typical days: `filed` is segment 1 (after preApplication)
    expect(fresh[0].segTypicalDays[1]).toBe(L.typicalMonths.discretionary.filed! * MONTH_DAYS);
    expect(flight[0].segTypicalDays[1]).toBe(2 * MONTH_DAYS);
    const t = DAYS.a.filed + 30;
    const within = (n: number) => 30 / MONTH_DAYS / n;
    expect(evalBar(flight[0], BOTH, t, Z).fill).toBeCloseTo((1 + within(2)) / 6, 12);
    expect(evalBar(fresh[0], BOTH, t, Z).fill).toBeCloseTo(
      (1 + within(L.typicalMonths.discretionary.filed!)) / 6,
      12
    );
    // and the chance reads the in-flight table
    expect(evalBar(flight[0], BOTH, t, Z).chance).toBeCloseTo(0.9, 6);
    expect(evalBar(fresh[0], BOTH, t, Z).chance).toBe(L.chance.discretionary.filed![0]);
  });

  it('without an inFlight set, an in-flight slot reads the fresh values', () => {
    const fresh = buildBars([cellOf('a')], L).filter((b) => b.projectId === SLOT.a.projectId);
    const flight = buildBars([inFlightCell('a')], L).filter(
      (b) => b.projectId === SLOT.a.projectId
    );
    expect(flight[0].segTypicalDays).toEqual(fresh[0].segTypicalDays);
    const t = DAYS.a.filed + 30;
    expect(evalBar(flight[0], L, t, Z)).toEqual(evalBar(fresh[0], L, t, Z));
  });
});

describe('barSizePx', () => {
  it('grows from 32 × 6 at z15 to 48 × 8 at z17 and clamps', () => {
    expect(barSizePx(15)).toEqual({ w: 32, h: 6 });
    expect(barSizePx(16)).toEqual({ w: 40, h: 7 });
    expect(barSizePx(17)).toEqual({ w: 48, h: 8 });
    expect(barSizePx(19)).toEqual(barSizePx(17));
    expect(barSizePx(12)).toEqual(barSizePx(15));
  });
});

describe('rampColor', () => {
  const css = ([r, g, b]: RGBA) => ({ mode: 'rgb' as const, r: r / 255, g: g / 255, b: b / 255 });
  for (const theme of ['light', 'dark'] as const) {
    const tok = TOKENS[theme];
    it(`${theme}: hits the stops at 0.15 / 0.45 / 0.75 and clamps outside`, () => {
      expect(rampColor(0, theme)).toEqual(hexToRgba(tok['tl-bar-unlikely']));
      expect(rampColor(0.15, theme)).toEqual(hexToRgba(tok['tl-bar-unlikely']));
      expect(rampColor(0.45, theme)).toEqual(hexToRgba(tok['tl-bar-uncertain']));
      expect(rampColor(0.75, theme)).toEqual(hexToRgba(tok['tl-bar-likely']));
      expect(rampColor(1, theme)).toEqual(hexToRgba(tok['tl-bar-likely']));
    });
    it(`${theme}: blends in linear RGB (luminance is the stops' mean at the midpoint)`, () => {
      const mid = wcagLuminance(css(rampColor(0.3, theme)));
      const ends = [tok['tl-bar-unlikely'], tok['tl-bar-uncertain']].map(wcagLuminance);
      expect(Math.abs(mid - (ends[0] + ends[1]) / 2)).toBeLessThan(0.003);
    });
  }
  it('property: every blend keeps ≥ 3:1 contrast against tl-bar-track, both themes', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.constantFrom('light' as const, 'dark' as const),
        (c, theme) => {
          const rgba = rampColor(c, theme);
          expect(rgba[3]).toBe(255);
          const ratio = wcagContrast(css(rgba), TOKENS[theme]['tl-bar-track']);
          expect(ratio).toBeGreaterThanOrEqual(3);
        }
      ),
      { numRuns: 200 }
    );
  });
});

describe('barColor', () => {
  const base = { visible: true, fill: 0.5, segCount: 5, alpha: 1 };
  for (const theme of ['light', 'dark'] as const) {
    const tok = TOKENS[theme];
    it(`${theme}: dead is tl-bar-dead, complete is tl-bar-likely, else the ramp`, () => {
      expect(barColor({ ...base, chance: null, dead: true }, theme)).toEqual(
        hexToRgba(tok['tl-bar-dead'])
      );
      // A complete bar has no chance (evalBar rule 3) and is never dead.
      expect(barColor({ ...base, fill: 1, chance: null, dead: false }, theme)).toEqual(
        hexToRgba(tok['tl-bar-likely'])
      );
      for (const c of [0, 0.2, 0.45, 0.6, 1])
        expect(barColor({ ...base, chance: c, dead: false }, theme)).toEqual(rampColor(c, theme));
    });
  }
  it('agrees with evalBar on the fixture: dead (b) after its exit, complete (a)', () => {
    const b = evalBar(bar('b'), L, DAYS.b.end + 10, Z);
    expect(b.dead).toBe(true);
    expect(barColor(b, 'light')).toEqual(hexToRgba(TOKENS.light['tl-bar-dead']));
    const a = evalBar(bar('a'), L, DAYS.a.complete + 10, Z);
    expect(a.fill).toBe(1);
    expect(barColor(a, 'light')).toEqual(hexToRgba(TOKENS.light['tl-bar-likely']));
  });
});
