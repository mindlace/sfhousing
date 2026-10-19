// Regenerates e2e/fixtures/timeline/fixture0-timeline.json: a revision-0 TimelineUpdate over
// fixture-0 parcels whose existing buildings appear in buildings.pmtiles, plus the timeline
// lookups the e2e feeds `setTimelineLookups`. Run deliberately, never from CI:
//   npx tsx src/lib/map/fixtures/build-timeline-fixture.ts
//
// Typed arrays are written as plain number arrays and NaN as null; the spec's `reviveTimeline`
// reverses both. Demolish days are each project's construction day, as timelapse-sim emits them.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fnv1a32, generate, type GeneratedBuilding } from '../../generator';
import { decodeParcelChunk } from '../../data/parcel-chunk';
import type { ParcelId } from '../../data/parcel';
import { STAGE_ORDER, type Stage } from '../../timelapse/types';
import type { Schedule } from '../../sim/scenario/types';
import { packTimedCell, type TimedPackInput } from '../pack-timed';
import { timelineLookups } from './timeline-lookups';

const FIXTURE = new URL(
  '../../../../e2e/fixtures/data/fixture-0/parcels/50_25.json',
  import.meta.url
);
const OUT_DIR = new URL('../../../../e2e/fixtures/timeline/', import.meta.url);

/** One project. Every parcel has a feature in fixture-0's buildings.pmtiles (checked against the tiles). */
interface Spec {
  projectId: string;
  parcelId: ParcelId;
  stories: number;
  pathway: Schedule['pathway'];
  entered: Partial<Record<Stage, number>>;
  end: Schedule['end'];
}

// Days are days since 1970-01-01; 20742 is 2026-10-16 (the timeline start).
const SPECS: Spec[] = [
  {
    // Constructs on 21400, completes on 22300: one demolish entry (day 21400).
    projectId: 'e2e-a',
    parcelId: '3512002',
    stories: 6,
    pathway: 'discretionary',
    entered: {
      filed: 20850,
      entitled: 21000,
      permitFiled: 21100,
      permitIssued: 21250,
      construction: 21400
    },
    end: { kind: 'complete', day: 22300 }
  },
  {
    // Constructs on 22000 and stays open: one demolish entry (day 22000).
    projectId: 'e2e-b',
    parcelId: '3512010',
    stories: 8,
    pathway: 'permitOnly',
    entered: { permitFiled: 21500, permitIssued: 21800, construction: 22000 },
    end: { kind: 'open' }
  },
  {
    // Withdrawn before it ever constructs: no demolish entry.
    projectId: 'e2e-c',
    parcelId: '3512011',
    stories: 5,
    pathway: 'streamlined',
    entered: { filed: 20900, entitled: 21000, permitFiled: 21200 },
    end: { kind: 'exit', stage: 'permitFiled', reason: 'withdrawn', day: 21500 }
  }
];

const parcels = new Map(
  decodeParcelChunk(JSON.parse(readFileSync(FIXTURE, 'utf8'))).map((p) => [p.id, p])
);

const items: TimedPackInput[] = SPECS.map((s) => {
  const parcel = parcels.get(s.parcelId);
  if (!parcel) throw new Error(`fixture-0 has no parcel ${s.parcelId}`);
  const building: GeneratedBuilding | null = generate(
    parcel,
    { maxStories: s.stories },
    fnv1a32(parcel.id),
    'max'
  );
  if (!building) throw new Error(`no building generated on ${s.parcelId} at ${s.stories} stories`);
  const entered: Schedule['entered'] = {};
  for (const stage of STAGE_ORDER) {
    const d = s.entered[stage];
    if (d !== undefined) entered[stage] = d;
  }
  const first = Math.min(...Object.values(s.entered));
  return {
    schedule: {
      projectId: s.projectId,
      origin: 'pipeline',
      parcelIds: [s.parcelId],
      pathway: s.pathway,
      entered,
      end: s.end,
      revisions: [{ day: first, units: building.units, stories: building.stories }],
      existingUnits: parcel.existingUnits,
      multiPhase: false,
      phase: null
    },
    massings: [building],
    pickParcelId: s.parcelId
  };
});

const cell = packTimedCell('e2e-0', items);
const demolish = SPECS.flatMap((s) =>
  s.entered.construction === undefined
    ? []
    : [{ parcelId: s.parcelId, day: s.entered.construction }]
).sort((a, b) => a.day - b.day || (a.parcelId < b.parcelId ? -1 : 1));

// JSON-safe copy: typed arrays become plain arrays (NaN prints as null via JSON.stringify).
function plain(x: unknown): unknown {
  if (ArrayBuffer.isView(x)) return Array.from(x as unknown as ArrayLike<number>);
  if (Array.isArray(x)) return x.map(plain);
  if (x && typeof x === 'object')
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, plain(v)]));
  return x;
}

// One line per object member, with arrays of numbers kept inline.
function format(x: unknown, indent = ''): string {
  const inner = indent + '  ';
  if (Array.isArray(x)) {
    if (x.every((v) => v === null || typeof v !== 'object')) return JSON.stringify(x);
    return `[\n${x.map((v) => inner + format(v, inner)).join(',\n')}\n${indent}]`;
  }
  if (x && typeof x === 'object') {
    const entries = Object.entries(x);
    return `{\n${entries
      .map(([k, v]) => `${inner}${JSON.stringify(k)}: ${format(v, inner)}`)
      .join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(x);
}

const json = {
  note: 'Generated by src/lib/map/fixtures/build-timeline-fixture.ts. Do not edit by hand.',
  timeline: { revision: 0, cells: [cell], removedCells: [], demolish },
  lookups: timelineLookups
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  fileURLToPath(new URL('fixture0-timeline.json', OUT_DIR)),
  format(plain(json)) + '\n'
);
console.log(`wrote ${items.length} projects, ${demolish.length} demolish entries`);
