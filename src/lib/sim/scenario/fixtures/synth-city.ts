// The scenario bench city (spec §4.11 "Bench setup"): the host.bench synthetic city (150,360
// parcels on plan-model's 420 × 358 grid in 16 × 16 cells), its T11 columns, 2,000 synthetic
// pipeline projects across every stage (multi-parcel rows and 5 phased masters among them), and
// a bench calibration tuned to about 8,000 initiations by 2050. Node-only (the `parcels.bin`
// deflate); used by scenario.bench.spec.ts.
//
// Fixture values only (tier 4, made up for the bench): not data. The yields are a simple
// floor-area rule, not the generator's: the bench measures cost, and the card's matched /
// approximate verdict is not on its path.
import { deflateRawSync } from 'node:zlib';
import type { Manifest } from '$lib/data/manifest';
import type { ParcelRecord } from '$lib/data/parcel';
import { encodeParcelChunk } from '$lib/data/parcel-chunk';
import {
  FILL_LEVELS,
  decodeScenarioPayload,
  encodeScenarioPayload,
  fillStories,
  type ScenarioParcels
} from '$lib/data/scenario-codec';
import { synthParcels } from '$lib/generator/fixtures/synth';
import { mulberry32 } from '$lib/generator/seed';
import type { InFlightProject, ProjectsFile } from '$lib/timelapse/projects';
import type { Day } from '$lib/timelapse/time';
import type { Calibration, Pathway, Provenance, Stage } from '$lib/timelapse/types';
import miniCalibrationJson from './mini-calibration.json';
import { MINI_AS_OF } from './mini-projects';

// host.bench's grid: 420 × 358 label points over ≈13.2 km × 11.1 km, 16 × 16 cells.
export const SYNTH_BBOX = [-122.51, 37.71, -122.36, 37.81] as const;
const [W, S, E, N] = SYNTH_BBOX;
const COLS = 420;
const ROWS = 358;
const CELLS = 16;
export const SYNTH_PARCELS = COLS * ROWS; // 150,360
export const SYNTH_VERSION = 'fixture-18';
export const SYNTH_AS_OF: Day = MINI_AS_OF;
/** Pipeline rows in projects.json, the 5 phased masters included. */
export const SYNTH_PROJECTS = 2000;
export const SYNTH_MASTERS = 5;
/**
 * The bench calibration's initiation intercept (the mini model's terms kept): tuned by hand so
 * that seed 1 initiates about 8,000 simulated projects by 2050 on this city (7,957).
 */
export const SYNTH_INTERCEPT = -9.85;

const URLS = {
  parcels: `/data/${SYNTH_VERSION}/scenarios/fzp/parcels.bin`,
  projects: `/data/${SYNTH_VERSION}/scenarios/fzp/projects.json`,
  calibration: `/data/${SYNTH_VERSION}/scenarios/fzp/calibration.json`
};

export interface SynthCity {
  /** Decoded T11, exactly as the host decodes `bin`. */
  parcels: ScenarioParcels;
  /** `projects.json` as served (valid for `parseProjectsFile`). */
  projects: ProjectsFile;
  /** `calibration.json` as served (valid for `parseCalibration`). */
  calibration: Calibration;
  manifest: Manifest;
  /** chunk URL → the parcel chunk JSON as served */
  chunks: Map<string, unknown>;
  /** `parcels.bin` as served: deflate-raw over the T11 payload */
  bin: Uint8Array;
  /** what the host fetches: the URL of `bin`, and url → body of every JSON file it may ask for */
  files: { bin: string; json: Map<string, unknown> };
}

const prov = (label: string): Provenance => ({
  tier: 4,
  label,
  sources: [{ label: 'timelapse-sim bench fixture', url: 'https://example.org/bench-fixture' }],
  method: 'Synthetic bench fixture (tier 4, made up); not data.'
});

const r7 = (v: number) => Math.round(v * 1e7) / 1e7;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const NO_CAP = 0xffff;

/** Gross units at `stories` on a lot: a simple floor-area rule (60% coverage, 90 m² a home). */
const grossUnits = (areaM2: number, stories: number) =>
  Math.min(60000, Math.floor((areaM2 * 0.6 * stories) / 90));

interface Lot {
  n: number; // grid position j * COLS + i
  rec: ParcelRecord;
  cellId: string;
  env: number;
}

function lotsOf(): Lot[] {
  const synth = synthParcels(SYNTH_PARCELS, 42);
  const lots: Lot[] = [];
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      const n = j * COLS + i;
      const rec: ParcelRecord = {
        ...synth[n].parcel,
        labelPoint: [r7(W + ((i + 0.5) * (E - W)) / COLS), r7(S + ((j + 0.5) * (N - S)) / ROWS)],
        eligible: n % 7 !== 0
      };
      const cellId = `${Math.floor((i * CELLS) / COLS)}_${Math.floor((j * CELLS) / ROWS)}`;
      lots.push({ n, rec, cellId, env: Math.min(80, synth[n].S) });
    }
  }
  return lots;
}

/** The T11 columns over the lots, rows sorted by (cellId, id). */
function t11Of(lots: Lot[]): ScenarioParcels {
  const rows = [...lots].sort((a, b) => cmp(a.cellId, b.cellId) || cmp(a.rec.id, b.rec.id));
  const cellIds = [...new Set(rows.map((r) => r.cellId))];
  const cellIndex = new Map(cellIds.map((c, k) => [c, k]));
  const count = rows.length;
  const F = FILL_LEVELS.length;
  const rand = mulberry32(18);
  const u8 = () => new Uint8Array(count);
  const p = {
    envelopeStories: u8(),
    baseStories: u8(),
    localProgram: u8(),
    hostable: u8(),
    eligible: u8(),
    split: u8(),
    imputed: u8(),
    existingStories: u8(),
    rentControlLikely: u8(),
    landUseClass: u8(),
    hostableBase: u8(),
    cell: new Uint16Array(count),
    district: new Uint16Array(count),
    baseCap: new Uint16Array(count),
    existingUnits: new Uint16Array(count),
    yearBuilt: new Uint16Array(count),
    existingFloorAreaM2: new Uint32Array(count),
    lotAreaM2: new Uint32Array(count),
    improvementShare: new Float32Array(count),
    labelPoint: new Float64Array(2 * count),
    yield: new Uint16Array(count * F),
    baseYield: new Uint16Array(count * F)
  };
  rows.forEach((row, i) => {
    const r = row.rec;
    const env = row.env;
    const base = env <= 4 ? env : Math.max(4, Math.floor(env / 2));
    const eligible = r.eligible ? 1 : 0;
    p.envelopeStories[i] = env;
    p.baseStories[i] = base;
    p.localProgram[i] = env >= 6 && rand() < 0.3 ? 1 : 0;
    p.eligible[i] = eligible;
    p.cell[i] = cellIndex.get(row.cellId)!;
    p.district[i] = env > 0 ? 1 : 0;
    p.existingUnits[i] = r.existingUnits;
    p.existingFloorAreaM2[i] = r.existingFloorAreaM2;
    p.existingStories[i] = Math.round(r.existingHeightM / 3.1);
    p.lotAreaM2[i] = Math.round(r.areaM2);
    p.yearBuilt[i] = r.existingFloorAreaM2 === 0 ? 0 : 1880 + Math.floor(rand() * 140);
    p.improvementShare[i] = Math.round(rand() * 200) / 200;
    p.rentControlLikely[i] = r.existingUnits >= 2 && p.yearBuilt[i] < 1979 ? 1 : 0;
    p.landUseClass[i] = r.existingUnits > 0 ? 0 : r.existingFloorAreaM2 === 0 ? 4 : 2;
    const cap = env <= 4 && rand() < 0.4 ? Math.max(2, Math.floor(r.areaM2 / 120)) : NO_CAP;
    p.baseCap[i] = cap;
    for (let f = 0; f < F; f++) {
      const gross = eligible ? grossUnits(r.areaM2, fillStories(FILL_LEVELS[f], env)) : 0;
      const baseGross =
        eligible && base > 0 ? grossUnits(r.areaM2, fillStories(FILL_LEVELS[f], base)) : 0;
      p.yield[i * F + f] = gross;
      p.baseYield[i * F + f] = Math.min(baseGross, cap);
    }
    p.hostable[i] = eligible && env >= 1 && p.yield[i * F + F - 1] > 0 ? 1 : 0;
    p.hostableBase[i] = eligible && base >= 1 && p.baseYield[i * F + F - 1] > 0 ? 1 : 0;
    p.labelPoint[2 * i] = r.labelPoint[0];
    p.labelPoint[2 * i + 1] = r.labelPoint[1];
  });
  let start = 0;
  const cells = cellIds.map((cellId) => {
    const n = rows.filter((r) => r.cellId === cellId).length;
    const c = { cellId, start, count: n };
    start += n;
    return c;
  });
  const parcels: ScenarioParcels = {
    format: 'sfh-scenario/1',
    datasetVersion: SYNTH_VERSION,
    scenario: 'fzp',
    rollYear: 2025,
    count,
    fillLevels: [...FILL_LEVELS],
    cells,
    districts: ['', 'BENCH'],
    provenance: {
      envelope: prov('Envelope'),
      localProgram: prov('Local Program'),
      features: prov('Features'),
      existingUnits: { ...prov('Existing units'), n: count, window: ['2025-01-01', '2025-12-31'] },
      yield: prov('Yield')
    },
    id: rows.map((r) => r.rec.id),
    index: new Map(rows.map((r, i) => [r.rec.id, i])),
    ...p,
    // derived at decode; the decoded copy below is the one returned
    potentialRatio: { fzp: new Float32Array(count), base: new Float32Array(count) },
    storiesGap: { fzp: new Int16Array(count), base: new Int16Array(count) }
  };
  return parcels;
}

/** The stages a row can be at, by pathway (permitOnly never files with Planning). */
const STAGES: Record<Pathway, Stage[]> = {
  discretionary: [
    'preApplication',
    'filed',
    'entitled',
    'permitFiled',
    'permitIssued',
    'construction',
    'complete'
  ],
  streamlined: ['filed', 'entitled', 'permitFiled', 'permitIssued', 'construction', 'complete'],
  permitOnly: ['permitFiled', 'permitIssued', 'construction', 'complete']
};
const STAGE_WEIGHTS: Record<Stage, number> = {
  preApplication: 0.05,
  filed: 0.2,
  entitled: 0.25,
  permitFiled: 0.2,
  permitIssued: 0.15,
  construction: 0.13,
  complete: 0.02
};

function pick<T>(rand: () => number, xs: readonly T[], weight: (x: T) => number): T {
  let total = 0;
  for (const x of xs) total += weight(x);
  let u = rand() * total;
  for (const x of xs) {
    u -= weight(x);
    if (u < 0) return x;
  }
  return xs[xs.length - 1];
}

/** History days ascending to `stage`, every one ≤ asOf; the row's stages on its pathway. */
function historyOf(rand: () => number, pathway: Pathway, stage: Stage): InFlightProject['history'] {
  const order = STAGES[pathway];
  const upTo = order.indexOf(stage);
  const from = pathway === 'discretionary' && rand() < 0.7 ? 1 : 0; // most skip preApplication
  const days: Day[] = [];
  let day = SYNTH_AS_OF - 20 - Math.floor(rand() * 900);
  for (let k = upTo; k >= Math.min(from, upTo); k--) {
    days.unshift(day);
    day -= 30 + Math.floor(rand() * 500);
  }
  const h: InFlightProject['history'] = {};
  order.slice(Math.min(from, upTo), upTo + 1).forEach((s, k) => (h[s] = days[k]));
  return h;
}

function projectsOf(lots: Lot[], parcels: ScenarioParcels): ProjectsFile {
  const rand = mulberry32(2000);
  const used = new Uint8Array(SYNTH_PARCELS);
  // a deterministic visiting order of grid positions (Fisher-Yates)
  const order = Array.from({ length: SYNTH_PARCELS }, (_, k) => k);
  for (let k = order.length - 1; k > 0; k--) {
    const j = Math.floor(rand() * (k + 1));
    [order[k], order[j]] = [order[j], order[k]];
  }
  let cursor = 0;
  /** `size` free, eligible lots in a row of the grid starting at the next free position. */
  const take = (size: number): string[] => {
    for (;;) {
      const n = order[cursor++];
      if (n % COLS > COLS - size) continue;
      let ok = true;
      for (let k = 0; k < size && ok; k++) ok = !used[n + k] && lots[n + k].rec.eligible;
      if (!ok) continue;
      for (let k = 0; k < size; k++) used[n + k] = 1;
      return Array.from({ length: size }, (_, k) => lots[n + k].rec.id).sort(cmp);
    }
  };
  const existingOf = (ids: string[]) =>
    ids.reduce((s, id) => s + parcels.existingUnits[parcels.index.get(id)!], 0);

  const out: InFlightProject[] = [];
  for (let k = 0; k < SYNTH_PROJECTS - SYNTH_MASTERS; k++) {
    const pathway = pick<Pathway>(rand, ['discretionary', 'streamlined', 'permitOnly'], (p) =>
      p === 'discretionary' ? 0.5 : p === 'streamlined' ? 0.2 : 0.3
    );
    const stage = pick(rand, STAGES[pathway], (s) => STAGE_WEIGHTS[s]);
    const size = rand() < 0.12 ? 2 + Math.floor(rand() * 3) : 1;
    const parcelIds = take(size);
    const existingUnits = existingOf(parcelIds);
    const units = existingUnits + 1 + Math.floor(rand() * rand() * rand() * 300);
    const stories = rand() < 0.6 ? 1 + Math.floor(rand() * 12) : null;
    const tag = String(k).padStart(5, '0');
    const id = pathway === 'permitOnly' ? `BP:SYN${tag}` : `PRJ:SYN-${tag}PRJ`;
    out.push({
      id,
      label: rand() < 0.8 ? `${100 + k} Bench St` : null,
      parcelIds,
      pathway,
      stage,
      history: historyOf(rand, pathway, stage),
      units,
      existingUnits,
      stories,
      storiesTier: stories === null ? null : 0,
      multiPhase: false,
      phases: null,
      sources: [{ dataset: 'bench', id: tag }],
      quality: []
    });
  }
  // 5 phased masters: 3 entitled, 2 still filed; 3-6 phases on blocks of 2-4 lots, plus one
  // development-agreement lot in no phase
  for (let m = 0; m < SYNTH_MASTERS; m++) {
    const entitled = m < 3;
    const nPhases = 3 + (m % 4);
    const phases: NonNullable<InFlightProject['phases']> = [];
    for (let i = 0; i < nPhases; i++) {
      const plan =
        i % 3 === 0 ? SYNTH_AS_OF + 60 + 200 * i : i % 3 === 1 ? SYNTH_AS_OF - 100 : null;
      phases.push({
        units: 50 + Math.floor(rand() * 350),
        parcelIds: take(2 + Math.floor(rand() * 3)),
        plannedPermitFiled: plan,
        source:
          plan === null
            ? null
            : {
                label: 'Bench DA phasing schedule',
                url: 'https://example.org/bench-da.pdf',
                retrieved: '2026-10-01'
              }
      });
    }
    const all = [...phases.flatMap((ph) => ph.parcelIds), ...take(1)].sort(cmp);
    out.push({
      id: `CASE:SYN-M${m}PRX`,
      label: `Bench Master ${m}`,
      parcelIds: all,
      pathway: 'discretionary',
      stage: entitled ? 'entitled' : 'filed',
      history: entitled
        ? { filed: SYNTH_AS_OF - 4000, entitled: SYNTH_AS_OF - 3000 + 300 * m }
        : { filed: SYNTH_AS_OF - 400 - 100 * m },
      units: phases.reduce((s, ph) => s + ph.units, 0),
      existingUnits: 0,
      stories: null,
      storiesTier: null,
      multiPhase: true,
      phases,
      sources: [{ dataset: 'bench', id: `M${m}` }],
      quality: []
    });
  }
  return {
    schema: 1,
    asOf: SYNTH_AS_OF,
    rhnaCompletedNet: { units: 20000, since: SYNTH_AS_OF - 1569, provenance: prov('Baseline') },
    qualityRules: [],
    projects: out
  };
}

function calibrationOf(): Calibration {
  const cal = structuredClone(miniCalibrationJson) as unknown as Calibration;
  cal.initiation = { ...cal.initiation, intercept: SYNTH_INTERCEPT };
  return cal;
}

/** A fresh bench city (deterministic; a few seconds to build). */
export function synthCity(): SynthCity {
  const lots = lotsOf();
  const payload = encodeScenarioPayload(t11Of(lots));
  const bin = deflateRawSync(payload);
  const parcels = decodeScenarioPayload(payload);
  const projects = projectsOf(lots, parcels);
  const calibration = calibrationOf();

  const byCell = new Map<string, ParcelRecord[]>();
  for (const l of lots)
    (byCell.get(l.cellId) ?? byCell.set(l.cellId, []).get(l.cellId)!).push(l.rec);
  const chunks = new Map<string, unknown>();
  const manifestChunks: Manifest['chunks'] = [];
  for (const cellId of [...byCell.keys()].sort(cmp)) {
    const recs = byCell.get(cellId)!;
    const url = `/data/${SYNTH_VERSION}/parcels/${cellId}.json`;
    chunks.set(url, JSON.parse(encodeParcelChunk(SYNTH_VERSION, cellId, recs)));
    let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const r of recs) {
      w = Math.min(w, r.labelPoint[0]);
      s = Math.min(s, r.labelPoint[1]);
      e = Math.max(e, r.labelPoint[0]);
      n = Math.max(n, r.labelPoint[1]);
    }
    manifestChunks.push({ cellId, bbox: [w, s, e, n], url, parcelCount: recs.length });
  }
  const manifest = {
    datasetVersion: SYNTH_VERSION,
    builtAt: '2026-10-18T00:00:00.000Z',
    sources: [],
    chunks: manifestChunks,
    buildingsTiles: `/data/${SYNTH_VERSION}/buildings/{z}/{x}/{y}.pbf`,
    basemapTiles: `/data/${SYNTH_VERSION}/basemap/{z}/{x}/{y}.pbf`,
    glyphs: `/data/${SYNTH_VERSION}/glyphs/{fontstack}/{range}.pbf`,
    neighborhoods: `/data/${SYNTH_VERSION}/neighborhoods.geojson`,
    scenarios: { fzp: { ...URLS } }
  } as Manifest;
  const json = new Map<string, unknown>(chunks);
  json.set(URLS.projects, projects);
  json.set(URLS.calibration, calibration);
  return {
    parcels,
    projects,
    calibration,
    manifest,
    chunks,
    bin: new Uint8Array(bin),
    files: { bin: URLS.parcels, json }
  };
}
