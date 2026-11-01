// bench:map only (docs/dev/map-perf.md "Height fog case"): a whole-city fog grid from seeded
// label points spread uniformly over FOG_BOUNDS, each with a limit of 4–40 stories.
import { FOG_BOUNDS, buildFogGrid, type FogGrid } from '../fog/grid';
import { mulberry32 } from './synthetic-city';

export function makeSyntheticFog(seed: number, n = 150_000): FogGrid {
  const rnd = mulberry32(seed);
  const [[w, s], [e, nth]] = FOG_BOUNDS;
  const labelPoint = new Float64Array(2 * n);
  const stories = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    labelPoint[2 * i] = w + rnd() * (e - w);
    labelPoint[2 * i + 1] = s + rnd() * (nth - s);
    stories[i] = 4 + Math.floor(rnd() * 37);
  }
  return buildFogGrid(labelPoint, stories);
}
