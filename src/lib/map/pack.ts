// Pure, worker-safe geometry packing. No DOM, no zod, no $app.
import { encodeAppearance } from './appearance';
import { TYPOLOGY_ORDER } from './types';
import type { PackedCell } from './types';
import type { GeneratedBuilding } from '$lib/generator';

export interface PackInput {
  building: GeneratedBuilding;
  existingUnits: number;
}

export function emptyPack(cellId: string): PackedCell {
  return {
    cellId,
    parcelIds: [],
    parcelMeta: new Uint32Array(0),
    partCount: 0,
    startIndices: new Uint32Array(1),
    positions: new Float64Array(0),
    partTopM: new Float32Array(0),
    partSlot: new Uint32Array(0),
    partAppearance: new Uint8Array(0),
    partTypology: new Uint8Array(0)
  };
}

/**
 * Closed (last vertex repeats the first), clockwise in lng/lat. The layer passes
 * `_normalize: false`, so deck takes these rings as already normalised: its side model draws a
 * wall from each vertex to the next and none from a ring's last vertex, which only covers the
 * closing edge when that vertex repeats the first.
 */
function normaliseRing(ring: readonly (readonly [number, number])[]): [number, number][] {
  let r = ring.map((v) => [v[0], v[1]] as [number, number]);
  const f = r[0],
    l = r[r.length - 1];
  if (r.length > 1 && f[0] === l[0] && f[1] === l[1]) r = r.slice(0, -1);
  let area = 0;
  for (let i = 0; i < r.length; i++) {
    const j = i + 1 < r.length ? i + 1 : 0;
    area += r[i][0] * r[j][1] - r[j][0] * r[i][1];
  }
  if (area > 0) r.reverse();
  if (r.length > 0) r.push([r[0][0], r[0][1]]);
  return r;
}

export function packCell(cellId: string, items: readonly PackInput[]): PackedCell {
  const sorted = [...items].sort((x, y) =>
    x.building.parcelId < y.building.parcelId
      ? -1
      : x.building.parcelId > y.building.parcelId
        ? 1
        : 0
  );
  for (let i = 1; i < sorted.length; i++)
    if (sorted[i].building.parcelId === sorted[i - 1].building.parcelId)
      throw new Error(`packCell: duplicate parcelId ${sorted[i].building.parcelId}`);

  const parcelMeta = new Uint32Array(4 * sorted.length);
  const rings: [number, number][][] = [];
  const topM: number[] = [];
  const slots: number[] = [];
  const typ: number[] = [];
  const appearance: number[] = [];
  sorted.forEach(({ building: b, existingUnits }, s) => {
    const ti = TYPOLOGY_ORDER.indexOf(b.typology);
    if (ti < 0) throw new Error(`packCell: unknown typology ${b.typology} on ${b.parcelId}`);
    parcelMeta.set([b.units, existingUnits, b.stories, ti], 4 * s);
    const renderParts: GeneratedBuilding['parts'] = [];
    for (const part of b.parts) {
      const previous = renderParts.at(-1);
      if (
        previous &&
        previous.role === 'occupied' &&
        part.role === 'occupied' &&
        previous.tone === part.tone &&
        previous.topM === part.baseM &&
        previous.footprint.length === part.footprint.length &&
        previous.footprint.every(
          (p, i) => p[0] === part.footprint[i][0] && p[1] === part.footprint[i][1]
        )
      ) {
        renderParts[renderParts.length - 1] = { ...previous, topM: part.topM };
      } else renderParts.push(part);
    }
    for (const part of renderParts) {
      rings.push(normaliseRing(part.footprint));
      topM.push(part.topM);
      slots.push(s);
      typ.push(ti);
      appearance.push(encodeAppearance(part.role, part.tone));
    }
  });

  const startIndices = new Uint32Array(rings.length + 1);
  let total = 0;
  rings.forEach((r, k) => {
    startIndices[k] = total;
    total += r.length;
  });
  startIndices[rings.length] = total;
  const positions = new Float64Array(2 * total);
  let o = 0;
  for (const r of rings)
    for (const v of r) {
      positions[o++] = v[0];
      positions[o++] = v[1];
    }
  return {
    cellId,
    parcelIds: sorted.map((i) => i.building.parcelId),
    parcelMeta,
    partCount: rings.length,
    startIndices,
    positions,
    partTopM: Float32Array.from(topM),
    partSlot: Uint32Array.from(slots),
    partAppearance: Uint8Array.from(appearance),
    partTypology: Uint8Array.from(typ)
  };
}

function cat<T extends Uint32Array | Float64Array | Float32Array | Uint8Array>(
  a: T,
  b: T,
  len = a.length + b.length
): T {
  const out = new (a.constructor as new (n: number) => T)(len);
  out.set(a, 0);
  return out;
}

/** a's slots first; b's slots and vertex offsets are remapped. */
export function concatPacks(a: PackedCell, b: PackedCell): PackedCell {
  const slotShift = a.parcelIds.length;
  const vertShift = a.positions.length / 2;
  const partCount = a.partCount + b.partCount;

  const parcelMeta = cat(a.parcelMeta, b.parcelMeta);
  parcelMeta.set(b.parcelMeta, a.parcelMeta.length);
  const positions = cat(a.positions, b.positions);
  positions.set(b.positions, a.positions.length);
  const partTopM = cat(a.partTopM, b.partTopM);
  partTopM.set(b.partTopM, a.partTopM.length);
  const partTypology = cat(a.partTypology, b.partTypology);
  partTypology.set(b.partTypology, a.partTypology.length);
  const partAppearance = cat(a.partAppearance, b.partAppearance);
  partAppearance.set(b.partAppearance, a.partAppearance.length);
  const partSlot = cat(a.partSlot, b.partSlot);
  for (let k = 0; k < b.partCount; k++) partSlot[a.partCount + k] = b.partSlot[k] + slotShift;
  const startIndices = new Uint32Array(partCount + 1);
  startIndices.set(a.startIndices.subarray(0, a.partCount), 0);
  for (let k = 0; k <= b.partCount; k++)
    startIndices[a.partCount + k] = b.startIndices[k] + vertShift;

  return {
    cellId: a.cellId,
    parcelIds: [...a.parcelIds, ...b.parcelIds],
    parcelMeta,
    partCount,
    startIndices,
    positions,
    partTopM,
    partSlot,
    partTypology,
    partAppearance
  };
}

export function packTransferables(p: PackedCell): ArrayBuffer[] {
  return [
    p.parcelMeta.buffer,
    p.startIndices.buffer,
    p.positions.buffer,
    p.partTopM.buffer,
    p.partSlot.buffer,
    p.partAppearance.buffer,
    p.partTypology.buffer
  ] as ArrayBuffer[];
}
