// Hand-made timeline fixture (spec §6 "Fixtures"): ten slots (a)–(i) in cells 'tl-A' and
// 'tl-B' over parcels-small.json / generated-small.json, packed with packTimedCell. Golden
// tests read days from DAYS and slots from SLOT; never hard-code either.
//
// Constructing slots (a, c, e, f, g, i1) have 3, 5 or 7 stories, so p = 0.5 and the 0.9 cap
// fall mid-floor (p · stories ends in .5, .3 or .7), and each completion comes 900 days after
// construction starts, well after the cap (≤ 0.9 · 24 months ≈ 657 days with timeline-lookups).
import gen from './generated-small.json';
import parcelsJson from './parcels-small.json';
import { packTimedCell, type TimedPackInput } from '../pack-timed';
import type { TimelineUpdate } from '../types';
import type { ParcelId, ParcelRecord } from '$lib/data/parcel';
import type { GeneratedBuilding } from '$lib/generator';
import { localFrame } from '$lib/generator/geo';
import type { Massing, Schedule } from '$lib/sim/scenario/types';
import { STAGE_ORDER, type Stage } from '$lib/timelapse/types';

const BUILDINGS = gen as unknown as GeneratedBuilding[];
const PARCELS = parcelsJson as unknown as ParcelRecord[];

/**
 * Named integer days (days since 1970-01-01). Per slot: each entered stage, `end` for a
 * completion or exit, and `rev0`, `rev1`, … for revision days. `start`/`horizon` bound them.
 */
export const DAYS = {
  start: 20742, // 2026-10-15
  horizon: 29584, // 2050-12-31
  // (a) discretionary with PPA, completes. Walkup, 5 stories.
  a: {
    preApplication: 20750,
    filed: 20950,
    entitled: 21300,
    permitFiled: 21500,
    permitIssued: 21750,
    construction: 22000,
    complete: 22900,
    end: 22900,
    rev0: 20750
  },
  // (b) streamlined, exits withdrawn at permitFiled. Midrise, 8 stories; never constructs.
  b: { filed: 20900, entitled: 21000, permitFiled: 21200, end: 21500, rev0: 20900 },
  // (c) permitOnly, in construction, open at the horizon. Podium, 7 stories.
  c: { permitFiled: 20800, permitIssued: 21100, construction: 21400, rev0: 20800 },
  // (d) discretionary, downsizes 12 → 6 stories at permitFiled (rev1); open before
  // construction. timelineSmallRev1 adds rev2 (back to 12 stories) at permitIssued.
  d: {
    filed: 20850,
    entitled: 21250,
    permitFiled: 21450,
    permitIssued: 21800,
    rev0: 20850,
    rev1: 21450,
    rev2: 21800
  },
  // (e) discretionary, dies (cancelled) 400 days into construction. Walkup, 5 stories.
  e: {
    filed: 20760,
    entitled: 21100,
    permitFiled: 21300,
    permitIssued: 21600,
    construction: 21900,
    end: 22300,
    rev0: 20760
  },
  // (f) simulated, streamlined, first stage in 2040, completes. Plex, 3 stories.
  f: {
    filed: 25700,
    entitled: 26000,
    permitFiled: 26200,
    permitIssued: 26500,
    construction: 26700,
    complete: 27600,
    end: 27600,
    rev0: 25700
  },
  // (g) pipeline, discretionary, `entitled` skipped (NaN), completes. Plex, 3 stories.
  g: {
    filed: 20780,
    permitFiled: 21000,
    permitIssued: 21350,
    construction: 21700,
    complete: 22600,
    end: 22600,
    rev0: 20780
  },
  // (h) multi-phase row without phase data: footprint-only on (a)'s parcel, completes.
  h: {
    filed: 21000,
    entitled: 21600,
    permitFiled: 22200,
    permitIssued: 22700,
    construction: 23300,
    complete: 24200,
    end: 24200,
    rev0: 21000
  },
  // (i1) phase 1 of 2 of DA master 'fx-i' (no master slot): starts at permitFiled, completes.
  // Podium, 5 stories.
  i1: {
    permitFiled: 21900,
    permitIssued: 22300,
    construction: 22700,
    complete: 23600,
    end: 23600,
    rev0: 21900
  },
  // (i2) phase 2 of 2: starts at permitFiled, dies (expired) at permitIssued. Tower, 24 stories.
  i2: { permitFiled: 23000, permitIssued: 23500, end: 24000, rev0: 23000 }
} as const;

type SlotKey = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g' | 'h' | 'i1' | 'i2';

/** Each slot's cell and pick parcel. Every slot has its own parcel except (h), on (a)'s. */
const PLACE: Record<SlotKey, { cellId: 'tl-A' | 'tl-B'; parcelId: ParcelId }> = {
  a: { cellId: 'tl-A', parcelId: '9000001' },
  c: { cellId: 'tl-A', parcelId: '9000045' },
  d: { cellId: 'tl-A', parcelId: '9000009' },
  e: { cellId: 'tl-A', parcelId: '9000003' },
  h: { cellId: 'tl-A', parcelId: '9000001' },
  b: { cellId: 'tl-B', parcelId: '9000012' },
  f: { cellId: 'tl-B', parcelId: '9000002' },
  g: { cellId: 'tl-B', parcelId: '9000007' },
  i1: { cellId: 'tl-B', parcelId: '9000061' },
  i2: { cellId: 'tl-B', parcelId: '9000022' }
};

/** Per slot: its projectId, cell and pick parcel (`parcelIds` entry in the packed cell). */
export const SLOT = Object.fromEntries(
  (Object.keys(PLACE) as SlotKey[]).map((k) => [k, { projectId: `fx-${k}`, ...PLACE[k] }])
) as Record<SlotKey, { projectId: string; cellId: string; parcelId: ParcelId }>;

function building(parcelId: ParcelId): GeneratedBuilding {
  const b = BUILDINGS.find((x) => x.parcelId === parcelId);
  if (!b) throw new Error(`timeline-small: no generated building on ${parcelId}`);
  return structuredClone(b);
}
function parcel(parcelId: ParcelId): ParcelRecord {
  const p = PARCELS.find((x) => x.id === parcelId);
  if (!p) throw new Error(`timeline-small: no parcel ${parcelId}`);
  return p;
}
/** The parcel's outer ring in lng/lat, as timelapse-sim builds a failed massing's footprint. */
function footprint(parcelId: ParcelId): { footprint: [number, number][] } {
  const p = parcel(parcelId);
  const f = localFrame(p.labelPoint);
  return { footprint: p.polygon[0].map(([x, y]) => f.to(x, y)) };
}
/** (d)'s downsized massing: the first part only (0–20 m: ground 4.5 m + 5 × 3.1 m). */
function downsized(b: GeneratedBuilding): GeneratedBuilding {
  return {
    ...b,
    parts: [b.parts[0]],
    stories: 6,
    units: 50,
    floorAreaM2: Math.round((b.floorAreaM2 * 6) / b.stories)
  };
}

function entered(d: Partial<Record<string, number>>): Schedule['entered'] {
  const out: Partial<Record<Stage, number>> = {};
  for (const s of STAGE_ORDER) if (d[s] !== undefined) out[s] = d[s];
  return out;
}
function storiesOf(m: Massing): number | null {
  return 'parts' in m ? m.stories : null;
}
function unitsOf(m: Massing, fallback: number): number {
  return 'parts' in m ? m.units : fallback;
}

interface SlotSpec {
  key: SlotKey;
  origin: Schedule['origin'];
  pathway: Schedule['pathway'];
  end: Schedule['end'];
  massings: Massing[];
  revDays: number[];
  multiPhase?: boolean;
  phase?: Schedule['phase'];
}

function item(spec: SlotSpec): TimedPackInput {
  const days = DAYS[spec.key];
  const parcelId = SLOT[spec.key].parcelId;
  const p = parcel(parcelId);
  return {
    schedule: {
      projectId: SLOT[spec.key].projectId,
      origin: spec.origin,
      parcelIds: [parcelId],
      pathway: spec.pathway,
      entered: entered(days),
      end: spec.end,
      revisions: spec.massings.map((m, i) => ({
        day: spec.revDays[i],
        units: unitsOf(m, 40),
        stories: storiesOf(m)
      })),
      existingUnits: p.existingUnits,
      multiPhase: spec.multiPhase ?? false,
      phase: spec.phase ?? null
    },
    massings: spec.massings,
    pickParcelId: parcelId
  };
}

const D = DAYS;

function specs(rev1: boolean): SlotSpec[] {
  const d9 = building(SLOT.d.parcelId);
  return [
    {
      key: 'a',
      origin: 'pipeline',
      pathway: 'discretionary',
      end: { kind: 'complete', day: D.a.end },
      massings: [building(SLOT.a.parcelId)],
      revDays: [D.a.rev0]
    },
    {
      key: 'b',
      origin: 'pipeline',
      pathway: 'streamlined',
      end: { kind: 'exit', stage: 'permitFiled', reason: 'withdrawn', day: D.b.end },
      massings: [building(SLOT.b.parcelId)],
      revDays: [D.b.rev0]
    },
    {
      key: 'c',
      origin: 'pipeline',
      pathway: 'permitOnly',
      end: { kind: 'open' },
      massings: [building(SLOT.c.parcelId)],
      revDays: [D.c.rev0]
    },
    {
      key: 'd',
      origin: 'pipeline',
      pathway: 'discretionary',
      end: { kind: 'open' },
      massings: rev1 ? [d9, downsized(d9), building(SLOT.d.parcelId)] : [d9, downsized(d9)],
      revDays: rev1 ? [D.d.rev0, D.d.rev1, D.d.rev2] : [D.d.rev0, D.d.rev1]
    },
    {
      key: 'e',
      origin: 'simulated',
      pathway: 'discretionary',
      end: { kind: 'exit', stage: 'construction', reason: 'cancelled', day: D.e.end },
      massings: [building(SLOT.e.parcelId)],
      revDays: [D.e.rev0]
    },
    {
      key: 'f',
      origin: 'simulated',
      pathway: 'streamlined',
      end: { kind: 'complete', day: D.f.end },
      massings: [building(SLOT.f.parcelId)],
      revDays: [D.f.rev0]
    },
    {
      key: 'g',
      origin: 'pipeline',
      pathway: 'discretionary',
      end: { kind: 'complete', day: D.g.end },
      massings: [building(SLOT.g.parcelId)],
      revDays: [D.g.rev0]
    },
    {
      key: 'h',
      origin: 'pipeline',
      pathway: 'discretionary',
      end: { kind: 'complete', day: D.h.end },
      massings: [footprint(SLOT.h.parcelId)],
      revDays: [D.h.rev0],
      multiPhase: true
    },
    {
      key: 'i1',
      origin: 'pipeline',
      pathway: 'discretionary',
      end: { kind: 'complete', day: D.i1.end },
      massings: [building(SLOT.i1.parcelId)],
      revDays: [D.i1.rev0],
      phase: { masterId: 'fx-i', index: 0, of: 2 }
    },
    {
      key: 'i2',
      origin: 'pipeline',
      pathway: 'discretionary',
      end: { kind: 'exit', stage: 'permitIssued', reason: 'expired', day: D.i2.end },
      massings: [building(SLOT.i2.parcelId)],
      revDays: [D.i2.rev0],
      phase: { masterId: 'fx-i', index: 1, of: 2 }
    }
  ];
}

function cell(cellId: 'tl-A' | 'tl-B', rev1: boolean) {
  return packTimedCell(
    cellId,
    specs(rev1)
      .filter((s) => SLOT[s.key].cellId === cellId)
      .map(item)
  );
}

/** Revision 0: both cells, and the complete demolish list (sorted by day). */
export const timelineSmall: TimelineUpdate = {
  revision: 0,
  cells: [cell('tl-A', false), cell('tl-B', false)],
  removedCells: [],
  demolish: [
    { parcelId: SLOT.c.parcelId, day: D.c.construction },
    { parcelId: SLOT.e.parcelId, day: D.e.construction },
    { parcelId: SLOT.a.parcelId, day: D.a.construction },
    // (h) on (a)'s parcel, later: one parcel in two entries (Review Focus 1).
    { parcelId: SLOT.h.parcelId, day: D.h.construction }
  ]
};

/** Revision 1: tl-A repacked with (d)'s third revision, tl-B removed, no demolish entries. */
export const timelineSmallRev1: TimelineUpdate = {
  revision: 1,
  cells: [cell('tl-A', true)],
  removedCells: ['tl-B'],
  demolish: []
};
