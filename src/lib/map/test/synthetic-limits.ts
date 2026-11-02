// bench:map only (docs/dev/map-perf.md "Height limits case"): the whole-city height limits and a
// downtown lid, built by the real builders on the main thread (the one place they run there).
// City: 150,000 seeded lots over CITY_BOUNDS, limits 4–40 stories. Lids: a 3 km × 3 km view of
// 25 ft × 100 ft lots in 3 × 2 blocks between 10 m streets, one limit per block (4–40), 1 lot in
// 20 an exception and 1 in 50 painted. The downtown lots are the first rows of the city's tables.
import { M_PER_DEG_LAT, M_PER_DEG_LNG, type BBox } from '$lib/plan/geometry';
import { SRC_FZP, SRC_PAINT } from '$lib/sim/levers/source';
import { CITY_BOUNDS, createCityBuild, type CityInput } from '../height/city';
import { createLidBuild, type LidInput, type LidLot } from '../height/lids';
import type { HeightCity, HeightLids } from '../height/types';
import { mulberry32 } from './synthetic-city';

/** The view centre: the bench camera's downtown (e2e/bench/map-timeline.bench.ts). */
const C_LNG = -122.401;
const C_LAT = 37.789;
const LOT_W = 7.62;
const LOT_D = 30.48;
const STREET = 10;
const VIEW_M = 3000;
const CITY_LOTS = 150_000;

function run<T>(b: { step(budget: number, now: () => number): boolean; result(): T }): T {
  while (!b.step(Infinity, () => performance.now()));
  return b.result();
}

export function makeSyntheticLimits(seed: number): { city: HeightCity; lids: HeightLids } {
  const rnd = mulberry32(seed);
  interface Lot {
    x0: number;
    y0: number;
    stories: number;
    src: number;
  }
  const downtown: Lot[] = [];
  const bw = 3 * LOT_W + STREET;
  const bh = 2 * LOT_D + STREET;
  for (let y = -VIEW_M / 2; y + bh <= VIEW_M / 2; y += bh)
    for (let x = -VIEW_M / 2; x + bw <= VIEW_M / 2; x += bw) {
      const base = 4 + Math.floor(rnd() * 37);
      for (let j = 0; j < 2; j++)
        for (let i = 0; i < 3; i++) {
          const r = rnd();
          const ex = r < 1 / 20;
          const paint = !ex && r < 1 / 20 + 1 / 50;
          downtown.push({
            x0: x + i * LOT_W,
            y0: y + j * LOT_D,
            stories: ex ? 4 + Math.floor(rnd() * 37) : base,
            src: paint ? SRC_PAINT : SRC_FZP
          });
        }
    }
  const nd = downtown.length;
  const n = Math.max(CITY_LOTS, nd);
  const input: CityInput = {
    rev: 1,
    labelPoint: new Float64Array(2 * n),
    lotAreaM2: new Uint32Array(n).fill(Math.round(LOT_W * LOT_D)),
    existingStories: new Uint8Array(n),
    stories: new Uint8Array(n),
    countable: new Uint8Array(n).fill(1),
    sources: { source: new Uint16Array(n), ruleIds: [] }
  };
  const lidLots: LidLot[] = [];
  downtown.forEach((l, i) => {
    const cx = l.x0 + LOT_W / 2;
    const cy = l.y0 + LOT_D / 2;
    input.labelPoint[2 * i] = C_LNG + cx / M_PER_DEG_LNG;
    input.labelPoint[2 * i + 1] = C_LAT + cy / M_PER_DEG_LAT;
    input.existingStories[i] = Math.floor(rnd() * 4);
    input.stories[i] = l.stories;
    input.sources.source[i] = l.src;
    const ring = (
      [
        [l.x0, l.y0],
        [l.x0 + LOT_W, l.y0],
        [l.x0 + LOT_W, l.y0 + LOT_D],
        [l.x0, l.y0 + LOT_D],
        [l.x0, l.y0]
      ] as [number, number][]
    ).map(([x, y]): [number, number] => [C_LNG + x / M_PER_DEG_LNG, C_LAT + y / M_PER_DEG_LAT]);
    lidLots.push({ row: i, rings: [ring] });
  });
  const [[w, s], [e, nth]] = CITY_BOUNDS;
  for (let i = nd; i < n; i++) {
    input.labelPoint[2 * i] = w + rnd() * (e - w);
    input.labelPoint[2 * i + 1] = s + rnd() * (nth - s);
    input.existingStories[i] = Math.floor(rnd() * 4);
    input.stories[i] = 4 + Math.floor(rnd() * 37);
  }
  const { city, model } = run(createCityBuild(input));
  const h = VIEW_M / 2;
  const bbox: BBox = [
    C_LNG - h / M_PER_DEG_LNG,
    C_LAT - h / M_PER_DEG_LAT,
    C_LNG + h / M_PER_DEG_LNG,
    C_LAT + h / M_PER_DEG_LAT
  ];
  const lidInput: LidInput = {
    limitsRev: input.rev,
    sourceIds: input.sources.ruleIds,
    bbox,
    lots: lidLots,
    stories: input.stories,
    sources: input.sources.source,
    model
  };
  return { city, lids: run(createLidBuild(lidInput)) };
}
