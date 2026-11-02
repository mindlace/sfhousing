/**
 * Shared height-limit fixtures: small scenes of rectangular lots in plan metres around
 * (LNG0, LAT0), run through the real city build and lid build. Used by the lid specs, the
 * HeightLimitsLayer GPU specs and the benches.
 */
import { LAT0, LNG0, M_PER_DEG_LAT, M_PER_DEG_LNG, type BBox } from '$lib/plan/geometry';
import { SRC_FZP, SRC_PAINT } from '$lib/sim/levers/source';
import { createCityBuild, type CityInput, type CityModel } from '../city';
import { createLidBuild, type LidInput, type LidLot } from '../lids';
import type { HeightCity, HeightLids } from '../types';

/** A 25 ft lot's frontage and a common lot depth (100 ft), in metres. */
export const LOT_W = 7.62;
export const LOT_D = 30.48;

/** A rectangular lot in plan metres east and north of (LNG0, LAT0). */
export interface RectLot {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  stories: number;
  src?: number;
  existing?: number;
  countable?: boolean;
}

export interface Scene {
  lots: RectLot[];
  city: HeightCity;
  model: CityModel;
  input: LidInput;
}

export function toLngLat(x: number, y: number): [number, number] {
  return [LNG0 + x / M_PER_DEG_LNG, LAT0 + y / M_PER_DEG_LAT];
}

/** nx × ny lots of LOT_W × LOT_D with the SW corner at (x0, y0); f(i, j) overrides lot (i, j). */
export function lotBlock(
  x0: number,
  y0: number,
  nx: number,
  ny: number,
  f: (i: number, j: number) => Partial<RectLot> = () => ({})
): RectLot[] {
  const out: RectLot[] = [];
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++)
      out.push({
        x0: x0 + i * LOT_W,
        y0: y0 + j * LOT_D,
        x1: x0 + (i + 1) * LOT_W,
        y1: y0 + (j + 1) * LOT_D,
        stories: 4,
        ...f(i, j)
      });
  return out;
}

function run<T>(b: { step(budget: number, now: () => number): boolean; result(): T }): T {
  while (!b.step(Infinity, () => performance.now()));
  return b.result();
}

/** The city build's input for the lots: label point = rectangle centre. */
export function cityInputOf(
  lots: readonly RectLot[],
  rev = 3,
  sourceIds: string[] = []
): CityInput {
  const n = lots.length;
  const input: CityInput = {
    rev,
    labelPoint: new Float64Array(2 * n),
    lotAreaM2: new Uint32Array(n),
    existingStories: new Uint8Array(n),
    stories: new Uint8Array(n),
    countable: new Uint8Array(n),
    sources: { source: new Uint16Array(n), ruleIds: sourceIds }
  };
  lots.forEach((l, i) => {
    const [lng, lat] = toLngLat((l.x0 + l.x1) / 2, (l.y0 + l.y1) / 2);
    input.labelPoint[2 * i] = lng;
    input.labelPoint[2 * i + 1] = lat;
    input.lotAreaM2[i] = Math.round((l.x1 - l.x0) * (l.y1 - l.y0));
    input.existingStories[i] = l.existing ?? 0;
    input.stories[i] = l.stories;
    input.countable[i] = (l.countable ?? true) && l.stories >= 1 ? 1 : 0;
    input.sources.source[i] = l.src ?? SRC_FZP;
  });
  return input;
}

/** Lid lots (row = index) for the lots, and the lng/lat bbox around them. */
export function lidLotsOf(lots: readonly RectLot[]): { lots: LidLot[]; bbox: BBox } {
  const out: LidLot[] = [];
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  lots.forEach((l, i) => {
    const ring: [number, number][] = [
      toLngLat(l.x0, l.y0),
      toLngLat(l.x1, l.y0),
      toLngLat(l.x1, l.y1),
      toLngLat(l.x0, l.y1),
      toLngLat(l.x0, l.y0)
    ];
    out.push({ row: i, rings: [ring] });
    w = Math.min(w, l.x0);
    s = Math.min(s, l.y0);
    e = Math.max(e, l.x1);
    n = Math.max(n, l.y1);
  });
  return { lots: out, bbox: [...toLngLat(w, s), ...toLngLat(e, n)] };
}

/** The city build over the lots, then a lid input over all of them. */
export function scene(
  lots: RectLot[],
  opts: { limitsRev?: number; sourceIds?: string[]; bbox?: BBox } = {}
): Scene {
  const cityInput = cityInputOf(lots, opts.limitsRev ?? 3, opts.sourceIds ?? []);
  const { city, model } = run(createCityBuild(cityInput));
  const lid = lidLotsOf(lots);
  const input: LidInput = {
    limitsRev: cityInput.rev,
    sourceIds: cityInput.sources.ruleIds,
    bbox: opts.bbox ?? lid.bbox,
    lots: lid.lots,
    stories: cityInput.stories,
    sources: cityInput.sources.source,
    model
  };
  return { lots, city, model, input };
}

/**
 * Synthetic city fabric over [x0, x0 + w] × [y0, y0 + h] m: blocks of 16 × 2 25 ft lots between
 * 20 m streets. Limits come in 600 m districts (2 to 40 stories); about 1 lot in 60 is an
 * exception, 1 in 150 is painted at its district's height, and 1 block in 13 is a park (0).
 */
export function synthBlocks(x0: number, y0: number, w: number, h: number): RectLot[] {
  const out: RectLot[] = [];
  const street = 20;
  const levels = [2, 4, 6, 8, 12, 40];
  let seed = 12345;
  const rand = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 4294967296;
  };
  const bw = 16 * LOT_W + street;
  const bh = 2 * LOT_D + street;
  let b = 0;
  for (let y = y0; y + bh <= y0 + h; y += bh)
    for (let x = x0; x + bw <= x0 + w; x += bw) {
      const park = b++ % 13 === 12;
      const di = Math.floor(x / 600);
      const dj = Math.floor(y / 600);
      const base = levels[(((di * 7 + dj * 13) % levels.length) + levels.length) % levels.length];
      out.push(
        ...lotBlock(x, y, 16, 2, () => {
          if (park) return { stories: 0 };
          const r = rand();
          const ex = r < 1 / 60;
          const paint = !ex && r < 1 / 60 + 1 / 150;
          return {
            stories: ex ? levels[Math.floor(rand() * levels.length)] : base,
            existing: Math.floor(rand() * 4),
            src: paint ? SRC_PAINT : SRC_FZP
          };
        })
      );
    }
  return out;
}

export function runLids(input: LidInput): HeightLids {
  return run(createLidBuild(input));
}

/** A 10 × 2 block of `base` stories; lot (4, 0) (interior, on the south street) is `ex`. */
export function exceptionInBlock(base: number, ex: number): Scene & { exception: number } {
  const lots = lotBlock(0, 0, 10, 2, (i, j) => ({ stories: i === 4 && j === 0 ? ex : base }));
  return { ...scene(lots), exception: 4 };
}

/** Two 8 × 2 blocks of 4 stories, existing 2, across a street of streetM; and the street centre. */
export function twoBlocks(streetM: number): Scene & { streetCentre: [number, number] } {
  const lots = [
    ...lotBlock(0, 0, 8, 2, () => ({ existing: 2 })),
    ...lotBlock(0, 2 * LOT_D + streetM, 8, 2, () => ({ existing: 2 }))
  ];
  return { ...scene(lots), streetCentre: toLngLat(4 * LOT_W, 2 * LOT_D + streetM / 2) };
}

/** An 8 × 2 block of `s` stories with open water to the west and a limit-0 park lot on its east. */
export function blockByWaterAndPark(s: number): Scene {
  return scene([
    ...lotBlock(0, 0, 8, 2, () => ({ stories: s })),
    { x0: 8 * LOT_W, y0: 0, x1: 8 * LOT_W + 40, y1: 2 * LOT_D, stories: 0 }
  ]);
}

/** An 8 × 2 block of `a` stories and one of `b` stories across a 20 m street. */
export function stepAcrossStreet(a: number, b: number): Scene {
  return scene([
    ...lotBlock(0, 0, 8, 2, () => ({ stories: a })),
    ...lotBlock(0, 2 * LOT_D + 20, 8, 2, () => ({ stories: b }))
  ]);
}

/** A 10 × 2 block of `s` stories (existing 1) whose lot (4, 0) is painted at the same height. */
export function paintedSameHeight(s: number): Scene & { painted: number } {
  const lots = lotBlock(0, 0, 10, 2, (i, j) => ({
    stories: s,
    existing: 1,
    src: i === 4 && j === 0 ? SRC_PAINT : SRC_FZP
  }));
  return { ...scene(lots), painted: 4 };
}

/**
 * About a dozen lots: two 3 × 2 blocks of 4 stories across a 20 m street, one 25 ft 6-story
 * exception (lot 1 of the south block), a 1 × 2 8-story strip sharing the south block's east side
 * (a wall), and one painted lot (lot 1 of the north block's back row).
 */
export function tinyLimitsScene(): Scene {
  const north = 2 * LOT_D + 20;
  return scene([
    ...lotBlock(0, 0, 3, 2, (i, j) => ({ stories: i === 1 && j === 0 ? 6 : 4, existing: 2 })),
    ...lotBlock(3 * LOT_W, 0, 1, 2, () => ({ stories: 8, existing: 3 })),
    ...lotBlock(0, north, 3, 2, (i, j) => ({
      existing: 1,
      src: i === 1 && j === 1 ? SRC_PAINT : SRC_FZP
    }))
  ]);
}

export function tinyLimits(): { city: HeightCity; lids: HeightLids } {
  const sc = tinyLimitsScene();
  return { city: sc.city, lids: runLids(sc.input) };
}
