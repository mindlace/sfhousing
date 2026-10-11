// Deterministic synthetic whole-city plan for client budget tests (spec §6). Not committed data.
import type { GeneratedBuilding, TypologyId } from '$lib/generator';
import { emptyPack, packCell, type PackInput } from '../pack';
import type { GeneratedUpdate, PackedCell } from '../types';

/** SF bbox (lng/lat). */
const W = -122.515,
  S = 37.708,
  E = -122.357,
  N = 37.833;
const M_LAT = 1 / 111_320;
const M_LNG = 1 / (111_320 * Math.cos((37.77 * Math.PI) / 180));
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

/** Clockwise rectangle (lng/lat) with its south-west corner at (x, y), w × h metres. */
function rect(x: number, y: number, w: number, h: number): [number, number][] {
  const x1 = x + w * M_LNG,
    y1 = y + h * M_LAT;
  return [
    [x, y],
    [x, y1],
    [x1, y1],
    [x1, y]
  ];
}

const SINGLE: TypologyId[] = ['adu', 'plex', 'walkup', 'midrise'];

function building(id: string, x: number, y: number, rnd: () => number): GeneratedBuilding {
  if (rnd() < 0.3) {
    const tower = rnd() < 0.5;
    const podiumTop = 4 + rnd() * 4;
    const top = tower ? 40 + rnd() * 60 : 18 + rnd() * 10;
    return {
      parcelId: id,
      source: 'user',
      composition: 'simple',
      typology: tower ? 'tower' : 'podium',
      parts: [
        { role: 'occupied', tone: 0, footprint: rect(x, y, 10, 30), baseM: 0, topM: podiumTop },
        {
          role: 'occupied',
          tone: 0,
          footprint: rect(x + 2 * M_LNG, y + 2 * M_LAT, 6, 26),
          baseM: podiumTop,
          topM: top
        }
      ],
      stories: Math.round(top / 3.2),
      units: tower ? 120 : 40,
      floorAreaM2: 3000,
      replacesExisting: true
    };
  }
  const typology = SINGLE[Math.floor(rnd() * SINGLE.length)];
  const top = 4 + rnd() * 20;
  return {
    parcelId: id,
    source: 'user',
    composition: 'simple',
    typology,
    parts: [{ role: 'occupied', tone: 0, footprint: rect(x, y, 10, 30), baseM: 0, topM: top }],
    stories: Math.max(1, Math.round(top / 3.2)),
    units: 2 + Math.floor(rnd() * 20),
    floorAreaM2: 400,
    replacesExisting: true
  };
}

/**
 * `n` parcels in cells of `perCell`, on a grid across the SF bbox. Revision 0 is a snapshot of
 * the first 10 cells (all settled); each later revision brings 10 more cells as `rising`.
 */
export function makeSyntheticCity(seed: number, n = 150_000, perCell = 1500): GeneratedUpdate[] {
  const rnd = mulberry32(seed);
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
      items.push({ building: building(id, x, y, rnd), existingUnits: Math.floor(rnd() * 3) });
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
