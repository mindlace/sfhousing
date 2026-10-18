import { describe, expect, it } from 'vitest';
import { SLOT, timelineSmall } from '../fixtures/timeline-small';
import { CHANCE_LEN, timelineLookups } from '../fixtures/timeline-lookups';
import { encodeParts, partAttrs, typicalDays } from './encode';
import { CHANCE_ROWS, MAX_CHANCE_LEN, chanceRow, packChanceTexture } from './lookups';
import type { TimelineLookups } from './types';
import { MONTH_DAYS, OPEN_DAY } from '$lib/timelapse/time';
import { PATHWAYS, STAGE_ORDER } from '$lib/timelapse/types';

type Chance = TimelineLookups['chance'];
const empty = (): Chance => ({ discretionary: {}, streamlined: {}, permitOnly: {} });
const q = (c: number) => Math.round(c * 255);

describe('packChanceTexture', () => {
  it('is 18 rows by the longest row, row = pathway · 6 + stage', () => {
    const t = packChanceTexture(timelineLookups.chance);
    expect(t.height).toBe(18);
    expect(CHANCE_ROWS).toBe(18);
    expect(t.width).toBe(CHANCE_LEN);
    expect(t.data).toHaveLength(18 * CHANCE_LEN);
    expect(chanceRow(PATHWAYS.indexOf('streamlined'), 'permitFiled')).toBe(6 * 1 + 3);
    const src = timelineLookups.chance.streamlined.permitFiled!;
    const row = t.data.subarray(9 * t.width, 10 * t.width);
    expect(Array.from(row)).toEqual(Array.from(src, q));
  });
  it('places every present row at pathway · 6 + STAGE_ORDER index', () => {
    const t = packChanceTexture(timelineLookups.chance);
    PATHWAYS.forEach((p, pi) => {
      for (const [stage, src] of Object.entries(timelineLookups.chance[p])) {
        const r = pi * 6 + STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
        expect(t.data[r * t.width + 7], `${p}.${stage}`).toBe(q(src![7]));
      }
    });
  });
  it('pads a short row with its last value', () => {
    const c = empty();
    c.discretionary.filed = Float32Array.from({ length: 30 }, (_, m) => m / 29);
    c.permitOnly.construction = Float32Array.from({ length: 10 }, (_, m) => 0.1 + 0.05 * m);
    const t = packChanceTexture(c);
    expect(t.width).toBe(30);
    const r = chanceRow(PATHWAYS.indexOf('permitOnly'), 'construction');
    const row = Array.from(t.data.subarray(r * 30, r * 30 + 30));
    expect(row.slice(0, 10)).toEqual(Array.from(c.permitOnly.construction, q));
    expect(row.slice(10)).toEqual(Array(20).fill(q(c.permitOnly.construction[9])));
  });
  it('leaves absent rows zero (streamlined.preApplication, permitOnly filed/entitled)', () => {
    const t = packChanceTexture(timelineLookups.chance);
    expect(timelineLookups.chance.streamlined.preApplication).toBeUndefined();
    for (const [pi, stage] of [
      [1, 'preApplication'],
      [2, 'filed'],
      [2, 'entitled']
    ] as const) {
      const r = chanceRow(pi, stage);
      expect(t.data.subarray(r * t.width, (r + 1) * t.width).every((v) => v === 0)).toBe(true);
    }
  });
  it('clamps values to [0, 1] before quantising', () => {
    const c = empty();
    c.streamlined.filed = Float32Array.from([1.5, -0.2, 0.5]);
    const t = packChanceTexture(c);
    const r = chanceRow(1, 'filed');
    expect(Array.from(t.data.subarray(r * 3, r * 3 + 3))).toEqual([255, 0, 128]);
  });
  it('accepts a 2048-long row and throws a RangeError above 2048', () => {
    expect(MAX_CHANCE_LEN).toBe(2048);
    const c = empty();
    c.discretionary.construction = new Float32Array(2048);
    expect(packChanceTexture(c).width).toBe(2048);
    c.discretionary.construction = new Float32Array(2049);
    expect(() => packChanceTexture(c)).toThrow(RangeError);
    expect(() => packChanceTexture(c)).toThrow(/discretionary\.construction.*2049/);
  });
});

describe('typical durations', () => {
  it('a missing typicalMonths entry becomes OPEN_DAY', () => {
    expect(timelineLookups.typicalMonths.streamlined.permitFiled).toBeUndefined();
    expect(typicalDays(timelineLookups, 'streamlined', 'permitFiled')).toBe(OPEN_DAY);
    const nonFinite: TimelineLookups = {
      chance: timelineLookups.chance,
      typicalMonths: { ...timelineLookups.typicalMonths, permitOnly: { construction: NaN } }
    };
    expect(typicalDays(nonFinite, 'permitOnly', 'construction')).toBe(OPEN_DAY);
    expect(typicalDays(null, 'discretionary', 'filed')).toBe(OPEN_DAY);
  });
  it('constructionTypicalDays = typicalMonths · MONTH_DAYS (encodeParts)', () => {
    for (const key of ['a', 'c', 'f'] as const) {
      const cell = timelineSmall.cells.find((c) => c.cellId === SLOT[key].cellId)!;
      const s = cell.slotProjectIds.indexOf(SLOT[key].projectId);
      const k = Array.from(cell.partSlot).indexOf(s);
      const pathway = PATHWAYS[cell.slotPathway[s]];
      const months = timelineLookups.typicalMonths[pathway].construction!;
      const a = partAttrs(encodeParts(cell, timelineLookups), k);
      expect(a.constructionTypicalDays, key).toBe(Math.fround(months * MONTH_DAYS));
      expect(partAttrs(encodeParts(cell, null), k).constructionTypicalDays).toBe(OPEN_DAY);
    }
  });
});
