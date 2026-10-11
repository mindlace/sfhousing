// Deterministic synthetic whole-city plan for client budget tests (spec §6). Not committed data.
import type { GeneratedBuilding } from '$lib/generator';
import { compositionDistrict } from '../fixtures/composition-district';
import { worstComposition } from './worst-composition';
import { emptyPack, packCell, type PackInput } from '../pack';
import type { GeneratedUpdate, PackedCell } from '../types';

/** SF bbox (lng/lat). */
const W = -122.515,
  S = 37.708,
  E = -122.357,
  N = 37.833;
/** Cells per update after the snapshot. */
const CELLS_PER_UPDATE = 10;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Complexity = 'representative' | 'worst';
const exemplarCache: Partial<Record<Complexity, GeneratedBuilding[]>> = {};
export function benchmarkExemplars(complexity: Complexity): GeneratedBuilding[] {
  return (exemplarCache[complexity] ??=
    complexity === 'worst'
      ? [worstComposition()]
      : [2, 3, 5, 6, 8, 12, 20, 40].flatMap(
          (stories) => compositionDistrict(42, stories).buildings
        ));
}
function building(
  id: string,
  x: number,
  y: number,
  rnd: () => number,
  exemplars: GeneratedBuilding[]
): GeneratedBuilding {
  const source = exemplars[Math.floor(rnd() * exemplars.length)];
  const anchor = source.parts[0].footprint[0];
  return {
    ...source,
    parcelId: id,
    parts: source.parts.map((p) => ({
      ...p,
      footprint: p.footprint.map(([lng, lat]) => [x + lng - anchor[0], y + lat - anchor[1]])
    }))
  };
}

/**
 * `n` parcels in cells of `perCell`, on a grid across the SF bbox. Revision 0 is a snapshot of
 * the first 10 cells (all settled); each later revision brings 10 more cells as `rising`.
 */
export function makeSyntheticCity(
  seed: number,
  n = 150_000,
  perCell = 1500,
  complexity: Complexity = 'representative'
): GeneratedUpdate[] {
  const rnd = mulberry32(seed);
  const exemplars = benchmarkExemplars(complexity);
  const nCells = Math.ceil(n / perCell);
  const cols = Math.ceil(Math.sqrt(nCells));
  const rows = Math.ceil(nCells / cols);
  const cw = (E - W) / cols,
    ch = (N - S) / rows;
  const side = Math.ceil(Math.sqrt(perCell));
  const packs: PackedCell[] = [];
  let made = 0;
  for (let c = 0; c < nCells; c++) {
    const cx = W + (c % cols) * cw,
      cy = S + Math.floor(c / cols) * ch;
    const count = Math.min(perCell, n - made);
    const items: PackInput[] = [];
    for (let i = 0; i < count; i++) {
      const x = cx + ((i % side) + 0.1 + rnd() * 0.3) * (cw / side);
      const y = cy + (Math.floor(i / side) + 0.05 + rnd() * 0.1) * (ch / side);
      const id = `S${seed}-${String(made + i).padStart(7, '0')}`;
      items.push({
        building: building(id, x, y, rnd, exemplars),
        existingUnits: Math.floor(rnd() * 3)
      });
    }
    made += count;
    packs.push(packCell(`syn-${String(c).padStart(4, '0')}`, items));
  }
  const updates: GeneratedUpdate[] = [];
  for (let g = 0; g * CELLS_PER_UPDATE < packs.length; g++) {
    const group = packs.slice(g * CELLS_PER_UPDATE, (g + 1) * CELLS_PER_UPDATE);
    updates.push({
      revision: g,
      cells: group.map((p) =>
        g === 0 ? { settled: p, rising: null } : { settled: emptyPack(p.cellId), rising: p }
      ),
      removedCells: [],
      hide: { add: group.flatMap((p) => p.parcelIds), remove: [] }
    });
  }
  return updates;
}
