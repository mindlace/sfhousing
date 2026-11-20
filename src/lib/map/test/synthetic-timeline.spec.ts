import { describe, expect, it } from 'vitest';
import {
  SYNTHETIC_END,
  SYNTHETIC_LOOKUPS,
  SYNTHETIC_START,
  makeSyntheticTimeline
} from './synthetic-timeline';
import { timelineLookups } from '../fixtures/timeline-lookups';
import type { TimedPackedCell } from '../types';
import { validateCityDelta } from '../city-delta';
import { STAGE_ORDER } from '$lib/timelapse/types';

const NS = STAGE_ORDER.length;
const stage = (s: (typeof STAGE_ORDER)[number]) => STAGE_ORDER.indexOf(s);
const PERMIT_ONLY = 2; // PATHWAYS index

/** Every typed array of a cell as raw bytes, plus its string arrays. */
function bytesOf(c: TimedPackedCell): unknown[] {
  return Object.values(c).map((v) =>
    ArrayBuffer.isView(v) ? Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) : v
  );
}

/** Distinct revision windows per slot: one per revision (each revision starts on its own day). */
function revisionsPerSlot(c: TimedPackedCell): number[] {
  const froms = c.slotProjectIds.map(() => new Set<number>());
  for (let k = 0; k < c.partCount; k++) froms[c.partSlot[k]].add(c.partWindow[2 * k]);
  return froms.map((s) => s.size);
}

describe('makeSyntheticTimeline', () => {
  it('is deterministic for a seed: the same seed gives a byte-identical first cell', () => {
    const a = makeSyntheticTimeline(7, 400, 200);
    const b = makeSyntheticTimeline(7, 400, 200);
    expect(bytesOf(a.cells[0])).toEqual(bytesOf(b.cells[0]));
    expect(a.demolish).toEqual(b.demolish);
    expect(bytesOf(makeSyntheticTimeline(8, 400, 200).cells[0])).not.toEqual(bytesOf(a.cells[0]));
  });

  it('is a revision-0 snapshot of n projects in cells of perCell', () => {
    const u = makeSyntheticTimeline(1, 3200, 1500);
    expect(u.revision).toBe(0);
    expect(u.removedCells).toEqual([]);
    expect(u.cells.map((c) => c.slotProjectIds.length)).toEqual([1500, 1500, 200]);
    expect(new Set(u.cells.map((c) => c.cellId)).size).toBe(3);
    const ids = u.cells.flatMap((c) => c.slotProjectIds);
    expect(new Set(ids).size).toBe(3200);
  });

  describe('3,000 projects', () => {
    const u = makeSyntheticTimeline(3, 3000);
    const cells = u.cells;
    const slots = cells.flatMap((c) => c.slotProjectIds.map((_, s) => ({ c, s })));

    it('has about 1.3 revisions per project', () => {
      const revs = cells.flatMap(revisionsPerSlot);
      expect(revs.length).toBe(3000);
      expect(Math.min(...revs)).toBe(1);
      expect(Math.max(...revs)).toBe(2);
      const mean = revs.reduce((a, b) => a + b, 0) / revs.length;
      expect(mean).toBeGreaterThanOrEqual(1.2);
      expect(mean).toBeLessThanOrEqual(1.4);
    });

    it('flags one project in ten (the halo bench case draws their marks)', () => {
      const flagged = slots.filter(({ c, s }) => c.slotFlags![s] !== 0).length;
      expect(flagged).toBe(300);
    });

    it('exits about 15% of projects', () => {
      const exits = slots.filter(({ c, s }) => c.slotEnd[2 * s + 1] === 2).length;
      expect(exits / slots.length).toBeGreaterThanOrEqual(0.12);
      expect(exits / slots.length).toBeLessThanOrEqual(0.18);
      // The other end kinds are both present: completions and projects open at the horizon.
      expect(slots.some(({ c, s }) => c.slotEnd[2 * s + 1] === 1)).toBe(true);
      expect(slots.some(({ c, s }) => c.slotEnd[2 * s + 1] === 0)).toBe(true);
    });

    it('puts every stage, end, revision and demolish day in [Day 20742, Day 29584]', () => {
      expect([SYNTHETIC_START, SYNTHETIC_END]).toEqual([20742, 29584]);
      const days: number[] = [];
      for (const c of cells) {
        for (const d of c.slotStages) if (!Number.isNaN(d)) days.push(d);
        for (let s = 0; s < c.slotProjectIds.length; s++)
          if (c.slotEnd[2 * s + 1] !== 0) days.push(c.slotEnd[2 * s]);
        for (let k = 0; k < c.partCount; k++) days.push(c.partWindow[2 * k]);
      }
      days.push(...u.demolish.map((d) => d.day));
      expect(days.length).toBeGreaterThan(3000);
      expect(days.every((d) => Number.isInteger(d))).toBe(true);
      expect(Math.min(...days)).toBeGreaterThanOrEqual(20742);
      expect(Math.max(...days)).toBeLessThanOrEqual(29584);
    });

    it('enters stages in pathway order and ends after the last stage entered', () => {
      for (const { c, s } of slots) {
        const entered = Array.from(c.slotStages.subarray(NS * s, NS * s + NS)).filter(
          (d) => !Number.isNaN(d)
        );
        expect(entered.length).toBeGreaterThan(0);
        for (let i = 1; i < entered.length; i++) expect(entered[i]).toBeGreaterThan(entered[i - 1]);
        if (c.slotEnd[2 * s + 1] === 2)
          expect(c.slotEnd[2 * s]).toBeGreaterThan(entered[entered.length - 1]);
        if (c.slotEnd[2 * s + 1] === 1)
          expect(c.slotEnd[2 * s]).toBe(c.slotStages[NS * s + stage('complete')]);
      }
    });

    it('mixes pathways: permitOnly never enters filed or entitled, and PPA is optional', () => {
      const pathways = new Set(slots.map(({ c, s }) => c.slotPathway[s]));
      expect([...pathways].sort()).toEqual([0, 1, 2]);
      const at = (c: TimedPackedCell, s: number, st: (typeof STAGE_ORDER)[number]) =>
        c.slotStages[NS * s + stage(st)];
      for (const { c, s } of slots)
        if (c.slotPathway[s] === PERMIT_ONLY) {
          expect(at(c, s, 'filed')).toBeNaN();
          expect(at(c, s, 'entitled')).toBeNaN();
        }
      const ppa = slots.filter(({ c, s }) => !Number.isNaN(at(c, s, 'preApplication'))).length;
      expect(ppa).toBeGreaterThan(0);
      expect(ppa).toBeLessThan(slots.length);
      // Revisions never land on or after the construction day (T5).
      for (const c of cells)
        for (let k = 0; k < c.partCount; k++) {
          const built = c.slotStages[NS * c.partSlot[k] + stage('construction')];
          if (!Number.isNaN(built)) expect(c.partWindow[2 * k]).toBeLessThan(built);
        }
    });

    it('carries one marker per project, at its site, with the days of its schedule and every tenth flagged', () => {
      const city = u.city!;
      expect(() => validateCityDelta(city)).not.toThrow();
      expect(city.rows).toBe(3000);
      expect(city.from).toBeUndefined();
      expect(Array.from(city.row)).toEqual(Array.from({ length: 3000 }, (_, i) => i));
      const f32 = (v: number) => Math.fround(v);
      const nan = (v: number) => (Number.isNaN(v) ? NaN : f32(v));
      let flagged = 0;
      for (const { c, s } of slots) {
        // The marker's row is the project's number (packing sorts the slots of a cell).
        const i = Number(c.slotProjectIds[s].slice(-7));
        // At its site: a vertex of its footprint (placeBuilding anchors a part's first there).
        let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
        for (let p = 0; p < c.partCount; p++) {
          if (c.partSlot[p] !== s) continue;
          for (let v = c.startIndices[p]; v < c.startIndices[p + 1]; v++) {
            [x0, x1] = [Math.min(x0, c.positions[2 * v]), Math.max(x1, c.positions[2 * v])];
            [y0, y1] = [Math.min(y0, c.positions[2 * v + 1]), Math.max(y1, c.positions[2 * v + 1])];
          }
        }
        const EPS = 1e-5; // float32 at San Francisco's longitude
        expect(city.lngLat[2 * i]).toBeGreaterThanOrEqual(x0 - EPS);
        expect(city.lngLat[2 * i]).toBeLessThanOrEqual(x1 + EPS);
        expect(city.lngLat[2 * i + 1]).toBeGreaterThanOrEqual(y0 - EPS);
        expect(city.lngLat[2 * i + 1]).toBeLessThanOrEqual(y1 + EPS);
        const at = (st: (typeof STAGE_ORDER)[number]) => c.slotStages[NS * s + stage(st)];
        const entitled = at('entitled');
        const approved = Number.isNaN(entitled) ? at('permitIssued') : entitled;
        const complete = c.slotEnd[2 * s + 1] === 1 ? c.slotEnd[2 * s] : NaN;
        expect(Array.from(city.days.subarray(3 * i, 3 * i + 3))).toEqual([
          nan(approved),
          nan(at('construction')),
          nan(complete)
        ]);
        // The final revision's homes (parcelMeta's units).
        expect(city.homes[i]).toBe(c.parcelMeta[4 * s]);
        expect(city.flags[i]).toBe(c.slotFlags![s]);
        if (city.flags[i]) flagged++;
        // Every tenth project by number.
        expect(city.flags[i] !== 0).toBe(i % 10 === 0);
      }
      expect(flagged).toBe(300);
      expect(city.homes.some((h) => h > 0)).toBe(true);
    });

    it('lists one demolish entry per project reaching construction, at that day', () => {
      const want = slots
        .filter(({ c, s }) => !Number.isNaN(c.slotStages[NS * s + stage('construction')]))
        .map(({ c, s }) => ({
          parcelId: c.parcelIds[s],
          day: c.slotStages[NS * s + stage('construction')]
        }));
      const key = (d: { parcelId: string; day: number }) => `${d.parcelId}@${d.day}`;
      expect(want.length).toBeGreaterThan(1000);
      expect(u.demolish.map(key).sort()).toEqual(want.map(key).sort());
    });
  });

  it('leaves the city out when asked (the bench cases before the citywide one)', () => {
    expect(makeSyntheticTimeline(1, 300, 200, false).city).toBeUndefined();
    expect(makeSyntheticTimeline(1, 300, 200).city!.rows).toBe(300);
  });

  it('re-exports the hand-made timeline lookups', () => {
    expect(SYNTHETIC_LOOKUPS).toBe(timelineLookups);
  });
});
