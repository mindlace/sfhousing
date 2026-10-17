import { describe, expect, it } from 'vitest';
import { DAYS, SLOT, timelineSmall, timelineSmallRev1 } from '../fixtures/timeline-small';
import { timelineLookups } from '../fixtures/timeline-lookups';
import { TYPOLOGY_ORDER, type TimedPackedCell } from '../types';
import { encodeParts, partAttrs, TINT_GROUP, typicalDays, validateTimedCell } from './encode';
import { FLOOR_CAP } from './constants';
import type { TimelineLookups } from './types';
import { FTF_M, GROUND_FTF_M } from '$lib/generator/constants';
import { MONTH_DAYS, OPEN_DAY } from '$lib/timelapse/time';
import { PATHWAYS, STAGE_ORDER } from '$lib/timelapse/types';

type SlotKey = keyof typeof SLOT;

function cellOf(key: SlotKey, u = timelineSmall): TimedPackedCell {
  const c = u.cells.find((x) => x.cellId === SLOT[key].cellId);
  if (!c) throw new Error(`no cell for ${key}`);
  return c;
}
/** Part indices of a slot, in pack order (revision order). */
function partsOf(key: SlotKey, u = timelineSmall): { cell: TimedPackedCell; parts: number[] } {
  const cell = cellOf(key, u);
  const s = cell.slotProjectIds.indexOf(SLOT[key].projectId);
  const parts: number[] = [];
  for (let k = 0; k < cell.partCount; k++) if (cell.partSlot[k] === s) parts.push(k);
  return { cell, parts };
}
function attrsOf(key: SlotKey, l: TimelineLookups | null = timelineLookups) {
  const { cell, parts } = partsOf(key);
  const e = encodeParts(cell, l);
  return parts.map((k) => partAttrs(e, k));
}

describe('TINT_GROUP', () => {
  it('maps stages to planning, permit and ready', () => {
    expect(STAGE_ORDER.map((s) => TINT_GROUP[s])).toEqual([
      'planning',
      'planning',
      'permit',
      'permit',
      'ready',
      'ready',
      'ready'
    ]);
  });
});

describe('typicalDays', () => {
  it('is months · MONTH_DAYS when the entry exists', () => {
    const m = timelineLookups.typicalMonths.discretionary.construction!;
    expect(typicalDays(timelineLookups, 'discretionary', 'construction')).toBe(m * MONTH_DAYS);
  });
  it('is OPEN_DAY for a missing entry, null lookups or a non-finite entry', () => {
    expect(typicalDays(timelineLookups, 'streamlined', 'permitFiled')).toBe(OPEN_DAY);
    expect(typicalDays(null, 'discretionary', 'construction')).toBe(OPEN_DAY);
    const bad = {
      ...timelineLookups,
      typicalMonths: { ...timelineLookups.typicalMonths, permitOnly: { construction: NaN } }
    };
    expect(typicalDays(bad, 'permitOnly', 'construction')).toBe(OPEN_DAY);
    bad.typicalMonths.permitOnly = { construction: Infinity };
    expect(typicalDays(bad, 'permitOnly', 'construction')).toBe(OPEN_DAY);
  });
});

describe('encodeParts (§4.2.1)', () => {
  it('produces three vec4 arrays of 4 · partCount', () => {
    for (const cell of timelineSmall.cells) {
      const e = encodeParts(cell, timelineLookups);
      for (const a of [e.tlA, e.tlB, e.tlC]) {
        expect(a).toBeInstanceOf(Float32Array);
        expect(a.length).toBe(4 * cell.partCount);
      }
    }
  });

  it('never leaves a NaN in any attribute', () => {
    for (const cell of timelineSmall.cells) {
      const e = encodeParts(cell, null);
      for (const a of [e.tlA, e.tlB, e.tlC]) expect(a.some(Number.isNaN)).toBe(false);
    }
  });

  it('ghostFrom is the first entered stage: the PPA day for (a), permitFiled for a phase', () => {
    for (const p of attrsOf('a')) expect(p.ghostFrom).toBe(DAYS.a.preApplication);
    for (const p of attrsOf('i1')) expect(p.ghostFrom).toBe(DAYS.i1.permitFiled);
    for (const p of attrsOf('f')) expect(p.ghostFrom).toBe(DAYS.f.filed);
  });

  it('permitDay = min(entitled, permitFiled): permitFiled for (g), whose entitled is NaN', () => {
    const g = attrsOf('g');
    expect(g.length).toBeGreaterThan(0);
    for (const p of g) expect(p.permitDay).toBe(DAYS.g.permitFiled);
    for (const p of attrsOf('a')) expect(p.permitDay).toBe(DAYS.a.entitled);
  });

  it('readyDay = permitIssued and constructionDay = construction, OPEN_DAY if never', () => {
    for (const p of attrsOf('a')) {
      expect(p.readyDay).toBe(DAYS.a.permitIssued);
      expect(p.constructionDay).toBe(DAYS.a.construction);
    }
    for (const p of attrsOf('b')) expect(p.constructionDay).toBe(OPEN_DAY);
  });

  it('an open slot (c) has endDay and completeDay OPEN_DAY, endKind 0', () => {
    for (const p of attrsOf('c')) {
      expect(p.endDay).toBe(OPEN_DAY);
      expect(p.completeDay).toBe(OPEN_DAY);
      expect(p.endKind).toBe(0);
    }
  });

  it('completeDay = endDay for a completion, OPEN_DAY for an exit', () => {
    for (const p of attrsOf('a')) {
      expect(p.endKind).toBe(1);
      expect(p.endDay).toBe(DAYS.a.end);
      expect(p.completeDay).toBe(DAYS.a.end);
    }
    for (const p of attrsOf('b')) {
      expect(p.endKind).toBe(2);
      expect(p.endDay).toBe(DAYS.b.end);
      expect(p.completeDay).toBe(OPEN_DAY);
    }
  });

  it('carries the part window: (d) splits at its revision day', () => {
    const d = attrsOf('d');
    expect(d.length).toBeGreaterThan(1);
    expect(d[0].partFrom).toBe(DAYS.d.rev0);
    expect(d[0].partTo).toBe(DAYS.d.rev1);
    expect(d.at(-1)!.partFrom).toBe(DAYS.d.rev1);
    expect(d.at(-1)!.partTo).toBe(OPEN_DAY);
  });

  it('groundFtfM is 4.5 for a midrise part and 3.1 for a walkup part', () => {
    const typology = (key: SlotKey) => {
      const { cell, parts } = partsOf(key);
      return TYPOLOGY_ORDER[cell.partTypology[parts[0]]];
    };
    expect(typology('b')).toBe('midrise');
    expect(typology('a')).toBe('walkup');
    for (const p of attrsOf('b')) expect(p.groundFtfM).toBe(GROUND_FTF_M);
    for (const p of attrsOf('a')) expect(p.groundFtfM).toBe(Math.fround(FTF_M));
  });

  it('stories come from parcelMeta (final revision); a footprint slot (h) has 0', () => {
    const { cell, parts } = partsOf('a');
    const e = encodeParts(cell, timelineLookups);
    for (const k of parts)
      expect(partAttrs(e, k).stories).toBe(cell.parcelMeta[4 * cell.partSlot[k] + 2]);
    expect(attrsOf('a')[0].stories).toBe(5);
    for (const p of attrsOf('h')) expect(p.stories).toBe(0);
  });

  it('constructionTypicalDays is OPEN_DAY without lookups, months · MONTH_DAYS with them', () => {
    for (const p of attrsOf('a', null)) expect(p.constructionTypicalDays).toBe(OPEN_DAY);
    const m = timelineLookups.typicalMonths.discretionary.construction!;
    for (const p of attrsOf('a'))
      expect(p.constructionTypicalDays).toBe(Math.fround(m * MONTH_DAYS));
    const mc = timelineLookups.typicalMonths.permitOnly.construction!;
    for (const p of attrsOf('c'))
      expect(p.constructionTypicalDays).toBe(Math.fround(mc * MONTH_DAYS));
  });
});

describe('validateTimedCell (§4.1 Validation)', () => {
  const base = () => structuredClone(cellOf('a'));
  const cases: [string, (c: TimedPackedCell) => void][] = [
    ['slotProjectIds length', (c) => c.slotProjectIds.pop()],
    ['partWindow length', (c) => (c.partWindow = c.partWindow.slice(1))],
    ['slotStages length', (c) => (c.slotStages = c.slotStages.slice(1))],
    ['slotEnd length', (c) => (c.slotEnd = c.slotEnd.slice(1))],
    ['slotPathway length', (c) => (c.slotPathway = c.slotPathway.slice(1))],
    ['slotPathway value', (c) => (c.slotPathway[0] = 3)],
    ['slotEnd kind', (c) => (c.slotEnd[1] = 3)]
  ];

  it('accepts every fixture cell', () => {
    for (const u of [timelineSmall, timelineSmallRev1])
      for (const c of u.cells) expect(() => validateTimedCell(c)).not.toThrow();
  });

  it.each(cases)('throws a TypeError naming the cell for a bad %s', (_, mutate) => {
    const c = base();
    mutate(c);
    expect(() => validateTimedCell(c)).toThrow(TypeError);
    expect(() => validateTimedCell(c)).toThrow(c.cellId);
    expect(() => encodeParts(c, timelineLookups)).toThrow(TypeError);
  });

  it('throws for a non-integer slotEnd kind', () => {
    const c = base();
    c.slotEnd[1] = 0.5;
    expect(() => validateTimedCell(c)).toThrow(TypeError);
  });
});

describe('timeline-small fixture invariants', () => {
  const all = [timelineSmall, timelineSmallRev1];

  it('has ten slots over cells tl-A and tl-B, each slot where SLOT says', () => {
    expect(timelineSmall.revision).toBe(0);
    expect(timelineSmall.cells.map((c) => c.cellId).sort()).toEqual(['tl-A', 'tl-B']);
    expect(timelineSmall.cells.reduce((n, c) => n + c.slotProjectIds.length, 0)).toBe(10);
    for (const key of Object.keys(SLOT) as SlotKey[])
      expect(cellOf(key).slotProjectIds).toContain(SLOT[key].projectId);
  });

  it('every day is an integer in [20742, 29584]', () => {
    for (const u of all) {
      for (const c of u.cells) {
        const days = [
          ...Array.from(c.slotStages),
          ...Array.from(c.slotEnd).filter((_, i) => i % 2 === 0),
          ...Array.from(c.partWindow).filter((d) => d !== OPEN_DAY)
        ].filter((d) => !Number.isNaN(d));
        for (const d of days) {
          expect(Number.isInteger(d)).toBe(true);
          expect(d).toBeGreaterThanOrEqual(DAYS.start);
          expect(d).toBeLessThanOrEqual(DAYS.horizon);
        }
      }
      for (const { day } of u.demolish) expect(Number.isInteger(day)).toBe(true);
    }
  });

  it('(h) shares its pick parcel with (a), and both have demolish entries there, (h) later', () => {
    expect(SLOT.h.parcelId).toBe(SLOT.a.parcelId);
    const there = timelineSmall.demolish.filter((x) => x.parcelId === SLOT.a.parcelId);
    expect(there.map((x) => x.day)).toEqual([DAYS.a.construction, DAYS.h.construction]);
    expect(DAYS.h.construction).toBeGreaterThan(DAYS.a.construction);
    expect(timelineSmall.demolish.map((x) => x.parcelId)).toEqual(
      expect.arrayContaining([SLOT.c.parcelId, SLOT.e.parcelId])
    );
    expect(timelineSmall.demolish).toHaveLength(4);
  });

  it("SLOT.parcelId is each slot's pick parcel in its packed cell", () => {
    for (const u of [timelineSmall, timelineSmallRev1])
      for (const c of u.cells)
        c.slotProjectIds.forEach((id, s) => {
          const key = (Object.keys(SLOT) as SlotKey[]).find((k) => SLOT[k].projectId === id)!;
          expect(c.parcelIds[s]).toBe(SLOT[key].parcelId);
        });
  });

  it('every other slot has its own pick parcel', () => {
    const picks = (Object.keys(SLOT) as SlotKey[])
      .filter((k) => k !== 'h')
      .map((key) => SLOT[key].parcelId);
    expect(new Set(picks).size).toBe(picks.length);
  });

  it('the absent chance row (streamlined.preApplication) is one no fixture slot enters', () => {
    const { chance } = timelineLookups;
    expect(chance.streamlined.preApplication).toBeUndefined();
    expect(chance.discretionary.preApplication).toHaveLength(241);
    expect(chance.permitOnly.filed).toBeUndefined();
    expect(chance.permitOnly.entitled).toBeUndefined();
    const PRE = STAGE_ORDER.indexOf('preApplication');
    for (const c of timelineSmall.cells)
      c.slotPathway.forEach((pw, s) => {
        if (PATHWAYS[pw] === 'streamlined')
          expect(Number.isNaN(c.slotStages[STAGE_ORDER.length * s + PRE])).toBe(true);
      });
  });

  it('constructing slots put p = 0.5 and the 0.9 cap mid-floor, and finish after the cap', () => {
    for (const key of ['a', 'c', 'e', 'f', 'g', 'i1'] as const) {
      const [p] = attrsOf(key);
      expect(p.constructionDay).toBeLessThan(OPEN_DAY);
      for (const frac of [0.5, FLOOR_CAP]) {
        const floors = frac * p.stories;
        const off = floors - Math.floor(floors);
        expect(off, `${key} at p = ${frac}`).toBeGreaterThanOrEqual(0.2);
        expect(off, `${key} at p = ${frac}`).toBeLessThanOrEqual(0.8);
      }
      if (p.endDay < OPEN_DAY)
        expect(p.endDay - p.constructionDay).toBeGreaterThan(
          (key === 'e' ? 0.5 : FLOOR_CAP) * p.constructionTypicalDays
        );
    }
  });

  it('(e) dies in construction, (b) and (i2) before it; (i) has no master slot', () => {
    const [e] = attrsOf('e');
    expect(e.endKind).toBe(2);
    expect(e.endDay).toBeGreaterThan(e.constructionDay);
    for (const key of ['b', 'i2'] as const) {
      const [p] = attrsOf(key);
      expect(p.endKind).toBe(2);
      expect(p.constructionDay).toBe(OPEN_DAY);
    }
    const ids = timelineSmall.cells.flatMap((c) => c.slotProjectIds);
    expect(ids).toHaveLength(10);
  });

  it('timelineSmallRev1 repacks tl-A with a third (d) revision and removes tl-B', () => {
    expect(timelineSmallRev1.revision).toBe(1);
    expect(timelineSmallRev1.cells.map((c) => c.cellId)).toEqual(['tl-A']);
    expect(timelineSmallRev1.removedCells).toEqual(['tl-B']);
    expect(timelineSmallRev1.demolish).toEqual([]);
    const { cell, parts } = partsOf('d', timelineSmallRev1);
    const w = parts.map((k) => cell.partWindow[2 * k]);
    expect(new Set(w)).toEqual(new Set([DAYS.d.rev0, DAYS.d.rev1, DAYS.d.rev2]));
    expect(cell.partWindow[2 * parts.at(-1)! + 1]).toBe(OPEN_DAY);
  });
});
