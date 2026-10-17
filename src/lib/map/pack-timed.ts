// Pure, worker-safe timeline packing (T7). No DOM, no zod, no $app, no deck or luma.
import { normaliseRing, renderParts } from './pack';
import { TYPOLOGY_ORDER } from './types';
import type { TimedPackedCell } from './types';
import type { GeneratedBuilding } from '$lib/generator';
import type { ParcelId } from '$lib/data/parcel';
import type { Massing, Schedule } from '$lib/sim/scenario/types';
import { OPEN_DAY } from '$lib/timelapse/time';
import { PATHWAYS, STAGE_ORDER } from '$lib/timelapse/types';

export interface TimedPackInput {
  schedule: Schedule;
  /** One entry per revision, index-aligned with `schedule.revisions`: a building or a footprint. */
  massings: Massing[];
  /** The slot's pick parcel: the project's largest-area parcel. */
  pickParcelId: ParcelId;
}

/** Height in metres of a footprint-only ghost. Tier 4: made up, display only. */
export const FOOTPRINT_M = 1;

const END_KIND = { open: 0, complete: 1, exit: 2 } as const;

function isBuilding(m: Massing): m is GeneratedBuilding {
  return 'parts' in m;
}

export function packTimedCell(cellId: string, items: readonly TimedPackInput[]): TimedPackedCell {
  const fail = (projectId: string, why: string): never => {
    throw new Error(`packTimedCell ${cellId}: project ${projectId} ${why}`);
  };
  const sorted = [...items].sort((x, y) =>
    x.schedule.projectId < y.schedule.projectId
      ? -1
      : x.schedule.projectId > y.schedule.projectId
        ? 1
        : 0
  );
  for (let i = 1; i < sorted.length; i++)
    if (sorted[i].schedule.projectId === sorted[i - 1].schedule.projectId)
      fail(sorted[i].schedule.projectId, 'is duplicated');

  const n = sorted.length;
  const parcelMeta = new Uint32Array(4 * n);
  const slotStages = new Float32Array(STAGE_ORDER.length * n);
  const slotEnd = new Float32Array(2 * n);
  const slotPathway = new Uint8Array(n);
  const rings: [number, number][][] = [];
  const topM: number[] = [];
  const slots: number[] = [];
  const typ: number[] = [];
  const appearance: number[] = [];
  const windows: number[] = [];

  sorted.forEach(({ schedule, massings }, s) => {
    const id = schedule.projectId;
    const { revisions } = schedule;
    if (revisions.length === 0) fail(id, 'has no revisions');
    if (massings.length !== revisions.length)
      fail(id, `has ${massings.length} massings for ${revisions.length} revisions`);
    for (let i = 1; i < revisions.length; i++)
      if (revisions[i].day < revisions[i - 1].day)
        fail(id, `has revision ${i} on day ${revisions[i].day} before day ${revisions[i - 1].day}`);

    let finalStories = 0;
    let finalTypology = 0;
    massings.forEach((m, i) => {
      const from = revisions[i].day;
      const to = revisions[i + 1]?.day ?? OPEN_DAY;
      if (isBuilding(m)) {
        const ti = TYPOLOGY_ORDER.indexOf(m.typology);
        if (ti < 0) fail(id, `has unknown typology ${m.typology} on ${m.parcelId}`);
        for (const part of renderParts(m)) {
          rings.push(part.ring);
          topM.push(part.topM);
          slots.push(s);
          typ.push(ti);
          appearance.push(part.appearance);
          windows.push(from, to);
        }
        finalStories = m.stories;
        finalTypology = ti;
      } else {
        rings.push(normaliseRing(m.footprint));
        topM.push(FOOTPRINT_M);
        slots.push(s);
        typ.push(0);
        appearance.push(0);
        windows.push(from, to);
        finalStories = 0;
        finalTypology = 0;
      }
    });

    parcelMeta.set(
      [revisions[revisions.length - 1].units, schedule.existingUnits, finalStories, finalTypology],
      4 * s
    );
    STAGE_ORDER.forEach((stage, j) => {
      slotStages[STAGE_ORDER.length * s + j] = schedule.entered[stage] ?? NaN;
    });
    const end = schedule.end;
    slotEnd[2 * s] = end.kind === 'open' ? NaN : end.day;
    slotEnd[2 * s + 1] = END_KIND[end.kind];
    slotPathway[s] = PATHWAYS.indexOf(schedule.pathway);
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
    parcelIds: sorted.map((i) => i.pickParcelId),
    parcelMeta,
    partCount: rings.length,
    startIndices,
    positions,
    partTopM: Float32Array.from(topM),
    partSlot: Uint32Array.from(slots),
    partAppearance: Uint8Array.from(appearance),
    partTypology: Uint8Array.from(typ),
    slotProjectIds: sorted.map((i) => i.schedule.projectId),
    partWindow: Float32Array.from(windows),
    slotStages,
    slotEnd,
    slotPathway
  };
}

export function packTimedTransferables(p: TimedPackedCell): ArrayBuffer[] {
  return [
    p.parcelMeta.buffer,
    p.startIndices.buffer,
    p.positions.buffer,
    p.partTopM.buffer,
    p.partSlot.buffer,
    p.partAppearance.buffer,
    p.partTypology.buffer,
    p.partWindow.buffer,
    p.slotStages.buffer,
    p.slotEnd.buffer,
    p.slotPathway.buffer
  ] as ArrayBuffer[];
}
