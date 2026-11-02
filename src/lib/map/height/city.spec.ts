import { describe, expect, it } from 'vitest';
import { LAT0, LNG0, M_PER_DEG_LAT, M_PER_DEG_LNG } from '$lib/plan/geometry';
import { SRC_FZP, SRC_NONE, SRC_PAINT, SRC_RULE0 } from '$lib/sim/levers/source';
import {
  CITY_CELL_M,
  CITY_FRAME,
  NO_COMPONENT,
  createCityBuild,
  type CityInput,
  type CityModel
} from './city';
import { glazeStep } from './room';
import { CHAIN_LIMIT, CHAIN_SOURCE, type HeightCity } from './types';

/** A synthetic lot on the city raster: (c, r) is a cell offset from a cell near (LNG0, LAT0). */
interface Lot {
  c: number;
  r: number;
  stories: number;
  existing?: number;
  countable?: boolean;
  src?: number;
  areaM2?: number;
  /** Metres off the cell centre. */
  dx?: number;
  dy?: number;
}

const F = CITY_FRAME;
const C0 = Math.floor(-F.x0 / F.cell);
const R0 = Math.floor(-F.y0 / F.cell);

function cellCentre(c: number, r: number, dx = 0, dy = 0): [number, number] {
  return [
    LNG0 + (F.x0 + (C0 + c + 0.5) * F.cell + dx) / M_PER_DEG_LNG,
    LAT0 + (F.y0 + (R0 + r + 0.5) * F.cell + dy) / M_PER_DEG_LAT
  ];
}

function grid(lots: Lot[], ruleIds: string[] = []): CityInput {
  const n = lots.length;
  const input: CityInput = {
    rev: 7,
    labelPoint: new Float64Array(2 * n),
    lotAreaM2: new Uint32Array(n),
    existingStories: new Uint8Array(n),
    stories: new Uint8Array(n),
    countable: new Uint8Array(n),
    sources: { source: new Uint16Array(n), ruleIds }
  };
  lots.forEach((l, i) => {
    const [lng, lat] = cellCentre(l.c, l.r, l.dx, l.dy);
    input.labelPoint[2 * i] = lng;
    input.labelPoint[2 * i + 1] = lat;
    input.lotAreaM2[i] = l.areaM2 ?? 225;
    input.existingStories[i] = l.existing ?? 0;
    input.stories[i] = l.stories;
    input.countable[i] = (l.countable ?? true) && l.stories >= 1 ? 1 : 0;
    input.sources.source[i] = l.src ?? SRC_FZP;
  });
  return input;
}

function block(c0: number, c1: number, r0: number, r1: number, f: (c: number, r: number) => Lot) {
  const out: Lot[] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push(f(c, r));
  return out;
}

function run(input: CityInput): { city: HeightCity; model: CityModel } {
  const b = createCityBuild(input);
  while (!b.step(Infinity, () => performance.now()));
  return b.result();
}

function chainCount(city: HeightCity): number {
  return city.chains.starts.length - 1;
}

function chainsWith(city: HeightCity, q: { kind?: number; hi?: number; lo?: number }): number[] {
  const out: number[] = [];
  for (let k = 0; k < chainCount(city); k++) {
    if (q.kind !== undefined && city.chains.kind[k] !== q.kind) continue;
    if (q.hi !== undefined && city.chains.hi[k] !== q.hi) continue;
    if (q.lo !== undefined && city.chains.lo[k] !== q.lo) continue;
    out.push(k);
  }
  return out;
}

function chainsTouchingSource(city: HeightCity, src: number): number {
  let n = 0;
  for (let k = 0; k < chainCount(city); k++)
    if (city.chains.srcA[k] === src || city.chains.srcB[k] === src) n++;
  return n;
}

const indexOf = (lots: Lot[], c: number, r: number) =>
  lots.findIndex((l) => l.c === c && l.r === r);

describe('createCityBuild', () => {
  it('two 4-story blocks across a street are one component; room sums countable lots only', () => {
    const lots = [
      ...block(0, 5, 0, 5, (c, r) => ({ c, r, stories: 4, existing: 2 })),
      ...block(7, 12, 0, 5, (c, r) => ({ c, r, stories: 4, existing: 2 }))
    ];
    lots.forEach((l, i) => (l.countable = i % 3 !== 0));
    const countableCount = lots.filter((l) => l.countable).length;
    const { model } = run(grid(lots));
    const a0 = indexOf(lots, 0, 0);
    const b0 = indexOf(lots, 12, 5);
    const comp = model.lotComponent[a0];
    expect(model.lotComponent[b0]).toBe(comp);
    expect(model.componentStories[comp]).toBe(4);
    expect(model.componentRoom[comp]).toBe(2 * countableCount);
    expect(model.componentGlaze[comp]).toBe(glazeStep(2 * countableCount * 225, lots.length * 225));
  });

  it('a 4 | 8 step gives a CHAIN_LIMIT chain with hi 8 and lo 4', () => {
    const { city } = run(grid(block(0, 19, 0, 9, (c, r) => ({ c, r, stories: c < 10 ? 4 : 8 }))));
    expect(chainsWith(city, { kind: CHAIN_LIMIT, hi: 8, lo: 4 }).length).toBeGreaterThan(0);
    expect(city.rev).toBe(7);
  });

  it('a single 6-story lot among 4s is its own component; its short chain gets no label', () => {
    const lots = block(0, 9, 0, 9, (c, r) => ({ c, r, stories: c === 5 && r === 5 ? 6 : 4 }));
    const { city, model } = run(grid(lots));
    const exception = indexOf(lots, 5, 5);
    const neighbour = indexOf(lots, 4, 5);
    expect(model.lotComponent[exception]).not.toBe(model.lotComponent[neighbour]);
    expect(model.componentStories[model.lotComponent[exception]]).toBe(6);
    expect(chainsWith(city, { kind: CHAIN_LIMIT, hi: 6, lo: 4 }).length).toBeGreaterThan(0);
    expect(city.labels.text).not.toContain('6');
  });

  it('a mismatched lot touching a same-height region joins it (no singleton, no step)', () => {
    const lots = block(0, 9, 0, 4, (c, r) => ({ c, r, stories: c < 5 ? 4 : 8 }));
    // 4-story lot whose label point sits in an 8-story lot's cell, next to the 4-story block
    lots.push({ c: 5, r: 2, dx: -5, stories: 4 });
    const x = lots.length - 1;
    const { city, model } = run(grid(lots));
    expect(model.lotComponent[x]).toBe(model.lotComponent[indexOf(lots, 4, 2)]);
    const fours = new Set(lots.flatMap((l, i) => (l.stories === 4 ? [model.lotComponent[i]] : [])));
    expect(fours.size).toBe(1);
    expect(chainsWith(city, { hi: 4, lo: 4 })).toHaveLength(0);
  });

  it('a mismatched lot with no same-height neighbour cell is a singleton', () => {
    const lots = block(0, 9, 0, 4, (c, r) => ({ c, r, stories: c < 5 ? 4 : 8 }));
    lots.push({ c: 5, r: 2, dx: -5, stories: 6 });
    const x = lots.length - 1;
    const { model } = run(grid(lots));
    const comp = model.lotComponent[x];
    expect(model.componentStories[comp]).toBe(6);
    expect(lots.filter((_, i) => model.lotComponent[i] === comp)).toHaveLength(1);
  });

  it('the shore is a contour with lo 0; open water gets no cells; a limit-0 lot has no component', () => {
    const lots = block(0, 9, 0, 9, (c, r) => ({ c, r, stories: 4 }));
    lots.push({ c: 20, r: 20, stories: 0 });
    const { city, model } = run(grid(lots));
    expect(chainsWith(city, { kind: CHAIN_LIMIT, lo: 0, hi: 4 }).length).toBeGreaterThan(0);
    expect(model.lotComponent[lots.length - 1]).toBe(NO_COMPONENT);
    // every vertex lies within a lot's reach (30 m) plus a cell of the block
    const [w, s] = cellCentre(0, 0, -45 - CITY_CELL_M, -45 - CITY_CELL_M);
    const [e, n] = cellCentre(9, 9, 45 + CITY_CELL_M, 45 + CITY_CELL_M);
    const p = city.chains.positions;
    expect(p.length).toBeGreaterThan(0);
    for (let i = 0; i < p.length; i += 2) {
      expect(p[i] > w && p[i] < e && p[i + 1] > s && p[i + 1] < n).toBe(true);
    }
    expect(chainsTouchingSource(city, SRC_NONE)).toBeGreaterThan(0);
  });

  it('a painted lot at its neighbours’ height is a CHAIN_SOURCE boundary with SRC_PAINT on one side', () => {
    const lots = block(0, 9, 0, 9, (c, r) => ({
      c,
      r,
      stories: 4,
      src: c >= 3 && c <= 5 && r >= 3 && r <= 5 ? SRC_PAINT : SRC_FZP
    }));
    const { city, model } = run(grid(lots));
    expect(
      chainsWith(city, { kind: CHAIN_SOURCE }).some(
        (k) => city.chains.srcA[k] === SRC_PAINT || city.chains.srcB[k] === SRC_PAINT
      )
    ).toBe(true);
    expect(new Set(model.lotComponent).size).toBe(1);
    expect(chainsWith(city, { kind: CHAIN_LIMIT, lo: 4 })).toHaveLength(0);
  });

  it('sourceIds are the LimitSources ruleIds; a rule-decided area is bounded by chains with its code', () => {
    const lots = block(0, 9, 0, 9, (c, r) => {
      const rule = c >= 5;
      return { c, r, stories: rule ? 6 : 4, src: rule ? SRC_RULE0 : SRC_FZP };
    });
    const { city } = run(grid(lots, ['r1']));
    expect(city.sourceIds).toEqual(['r1']);
    expect(chainsTouchingSource(city, SRC_RULE0)).toBeGreaterThan(0);
  });

  it('a long 4 | 40 chain is labelled "40+" from z15 or lower; labels lie on the ground', () => {
    const { city } = run(grid(block(0, 19, 0, 29, (c, r) => ({ c, r, stories: c < 10 ? 4 : 40 }))));
    expect(city.labels.text).toContain('40+');
    expect(Math.min(...city.labels.minZoom)).toBeLessThanOrEqual(15);
    for (let i = 2; i < city.labels.position.length; i += 3)
      expect(city.labels.position[i]).toBe(0);
  });

  it('step(budget) returns false until done and finishes', () => {
    const input = grid(block(0, 9, 0, 9, (c, r) => ({ c, r, stories: c < 5 ? 4 : 8 })));
    const b = createCityBuild(input);
    let n = 0;
    while (!b.step(0, () => 0)) n++;
    expect(n).toBeGreaterThan(3);
    const once = run(input);
    expect([...b.result().city.chains.positions]).toEqual([...once.city.chains.positions]);
    expect([...b.result().model.lotComponent]).toEqual([...once.model.lotComponent]);
  });
});
