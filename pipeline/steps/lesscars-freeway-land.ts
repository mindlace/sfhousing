// `npm run pipeline -- lesscars-freeway-land`: propose freeway-land parcels for each segment of
// the catalog (pipeline/enrichment/lesscars/freeway-land.json) from the locked sources, into
// freeway-land.candidates.json. It never writes the catalog: the curated list is the source of
// truth, and the rule (86_freeway_land.sql) only proposes. Offline.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path, { dirname, join, resolve } from 'node:path';
import type { ParcelId } from '../../src/lib/data/parcel';
import { parseProjectsFile } from '../../src/lib/timelapse/projects';
import { LC, LESSCARS_FREEWAY_LAND_JSON } from '../lesscars-config';
import { createTableFromRows, openDuck, runSqlFile } from '../lib/duck';
import { readFreewayLand } from '../lib/lesscars/freeway-land';
import { readLock, rawPath } from '../lib/lock';
import { createQualityTables } from '../lib/quality';
import { runSql } from '../lib/sql';
import { loadNormalised, normaliseAll } from '../sources/normalise';
import { PARCELS_BIN, readParcelsBin } from './scenario';

const ENRICHMENT = resolve(import.meta.dirname, '../enrichment/lesscars');
export const FREEWAY_LAND_CANDIDATES_JSON = join(ENRICHMENT, 'freeway-land.candidates.json');
const SQL_FILE = resolve(import.meta.dirname, '../sql/86_freeway_land.sql');
const OUT_ROOT = resolve(import.meta.dirname, '../out');
const PROJECTS_JSON = 'scenarios/fzp/projects.json';

export interface FreewayCandidate {
  parcel: ParcelId;
  areaM2: number;
  inBandShare: number;
  distM: number;
  landUse: string;
  zoning: string | null;
  units: number;
  heightM: number;
  labelLngLat: [number, number];
  fzpTopYield: number | null;
  hostable: boolean | null;
  inFlight: string[] | null; // null without --dataset
  status: 'listed' | 'excluded' | 'new'; // against the segment's current catalog entry
  /** land use OPENSPACE: proposed, but flagged for curation (a park is an exclusion). */
  openSpace: boolean;
}

export interface FreewayCandidatesFile {
  schema: 1;
  source: { lockSha256: string; dataset: string | null };
  rule: { bandM: number; minShare: number };
  segments: { id: string; candidates: FreewayCandidate[]; rowM2: number }[];
}

/** Prettier's JSON layout (the enrichment JSON is prettier-checked). */
async function formatJson(v: unknown): Promise<string> {
  const prettier = await import('prettier');
  return prettier.format(JSON.stringify(v), { parser: 'json', printWidth: 100, tabWidth: 2 });
}

/** Newest `pipeline/out/<v>` holding a parcels.bin, or null. */
function newestDataset(): string | null {
  if (!existsSync(OUT_ROOT)) return null;
  const dirs = readdirSync(OUT_ROOT)
    .filter((d) => existsSync(join(OUT_ROOT, d, PARCELS_BIN)))
    .sort((a, b) => statSync(join(OUT_ROOT, b)).mtimeMs - statSync(join(OUT_ROOT, a)).mtimeMs);
  return dirs[0] ? join(OUT_ROOT, dirs[0]) : null;
}

const ha = (m2: number) => (m2 / 10_000).toFixed(2);

export async function lesscarsFreewayLand(a: {
  lockPath: string;
  rawDir: string;
  byName?: boolean;
  catalogPath?: string;
  outPath?: string;
  /** A built dataset dir for the FZP fields; undefined: the newest out dir, null: none. */
  datasetDir?: string | null;
  rule?: { bandM: number; minShare: number };
  /** The SB 79 exemptions CSV (default: the vendored live one). */
  exemptionsCsv?: string;
}): Promise<number> {
  const catalogPath = a.catalogPath ?? LESSCARS_FREEWAY_LAND_JSON.live;
  const outPath = a.outPath ?? FREEWAY_LAND_CANDIDATES_JSON;
  const rule = a.rule ?? { bandM: LC.freewayBandM, minShare: LC.freewayMinShare };
  if (!existsSync(a.lockPath)) {
    console.error(`no ${a.lockPath}: run \`npm run pipeline -- fetch\` first`);
    return 1;
  }
  const catalog = readFreewayLand(catalogPath);
  if (!catalog) {
    console.error(`no ${catalogPath}: the catalog lists the segments to propose parcels for`);
    return 1;
  }
  const lock = readLock(a.lockPath);
  const missing = lock.sources.flatMap((s) =>
    s.files
      .filter((f) => !existsSync(rawPath(a.rawDir, f, a.byName)))
      .map((f) => `${s.id} ${f.name}`)
  );
  if (missing.length > 0) {
    for (const m of missing) console.error(`missing raw file ${m}`);
    return 1;
  }
  const datasetDir = a.datasetDir === undefined ? newestDataset() : a.datasetDir;

  const work = mkdtempSync(join(tmpdir(), 'sfh-lc-fl-'));
  const db = await openDuck();
  type Row = {
    segment_id: string;
    id: string;
    area_m2: number;
    in_band_share: number;
    dist_m: number;
    land_use: string;
    zoning: string | null;
    units: number;
    height_m: number;
    label_lng: number;
    label_lat: number;
  };
  let candidates: Row[];
  let rowM2: { segment_id: string; row_m2: number }[];
  try {
    await normaliseAll(db, lock, a.rawDir, join(work, 'norm'), {
      byName: a.byName,
      exemptionsCsv: a.exemptionsCsv
    });
    await loadNormalised(db, join(work, 'norm'));
    await createQualityTables(db);
    await runSql(db);
    const have = new Set(
      (
        await db.all<{ cnn: string }>('SELECT DISTINCT cnn FROM src_streets WHERE cnn IS NOT NULL')
      ).map((r) => r.cnn)
    );
    const lost = [
      ...new Set(
        catalog.segments.flatMap((s) =>
          s.cnn.filter((c) => !have.has(c)).map((c) => `${s.id}: ${c}`)
        )
      )
    ];
    if (lost.length > 0) {
      for (const l of lost) console.error(`src_streets lacks CNN ${l}`);
      return 1;
    }
    await createTableFromRows(
      db,
      'fl_seg',
      [
        ['segment_id', 'VARCHAR'],
        ['ord', 'INTEGER'],
        ['cnn', 'VARCHAR']
      ],
      catalog.segments.flatMap((s, i) => s.cnn.map((c) => [s.id, i, c]))
    );
    await db.run(`SET VARIABLE fl_band_m = ${Number(rule.bandM)}`);
    await db.run(`SET VARIABLE fl_min_share = ${Number(rule.minShare)}`);
    await runSqlFile(db, SQL_FILE);
    candidates = await db.all<Row>(
      'SELECT * FROM fl_candidate ORDER BY ord, in_band_share DESC, id'
    );
    rowM2 = await db.all('SELECT segment_id, row_m2 FROM fl_row ORDER BY ord');
  } finally {
    db.close();
    rmSync(work, { recursive: true, force: true });
  }

  // FZP fields from a built dataset (null without one).
  let parcels: ReturnType<typeof readParcelsBin> | null = null;
  const naming = new Map<ParcelId, string[]>();
  if (datasetDir !== null && existsSync(join(datasetDir, PARCELS_BIN))) {
    parcels = readParcelsBin(join(datasetDir, PARCELS_BIN));
    const pj = join(datasetDir, PROJECTS_JSON);
    if (existsSync(pj)) {
      for (const p of parseProjectsFile(JSON.parse(readFileSync(pj, 'utf8'))).projects) {
        const ids = new Set([...p.parcelIds, ...(p.phases ?? []).flatMap((ph) => ph.parcelIds)]);
        for (const id of ids) naming.set(id, [...(naming.get(id) ?? []), p.id]);
      }
    }
  }

  const out: FreewayCandidatesFile = {
    schema: 1,
    source: {
      lockSha256: createHash('sha256').update(readFileSync(a.lockPath)).digest('hex'),
      dataset: parcels && datasetDir ? path.basename(datasetDir) : null
    },
    rule,
    segments: catalog.segments.map((s) => {
      const listed = new Set(s.parcels);
      const excluded = new Set(s.excluded.map((e) => e.parcel));
      const mine = candidates.filter((c) => c.segment_id === s.id);
      return {
        id: s.id,
        rowM2: Math.round(rowM2.find((r) => r.segment_id === s.id)?.row_m2 ?? 0),
        candidates: mine.map((c): FreewayCandidate => {
          const i = parcels?.index.get(c.id);
          const F = parcels?.fillLevels.length ?? 0;
          return {
            parcel: c.id,
            areaM2: Math.round(c.area_m2),
            inBandShare: Math.round(c.in_band_share * 1000) / 1000,
            distM: Math.round(c.dist_m * 10) / 10,
            landUse: c.land_use,
            zoning: c.zoning,
            units: c.units,
            heightM: c.height_m,
            labelLngLat: [c.label_lng, c.label_lat],
            fzpTopYield: parcels && i !== undefined ? parcels.yield[i * F + F - 1] : null,
            hostable: parcels && i !== undefined ? parcels.hostable[i] === 1 : null,
            inFlight: parcels ? (naming.get(c.id) ?? []) : null,
            status: listed.has(c.id) ? 'listed' : excluded.has(c.id) ? 'excluded' : 'new',
            openSpace: c.land_use === 'OPENSPACE'
          };
        })
      };
    })
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, await formatJson(out));
  for (const s of out.segments) {
    const n = (st: FreewayCandidate['status']) =>
      s.candidates.filter((c) => c.status === st).length;
    const area = s.candidates.reduce((t, c) => t + c.areaM2, 0);
    console.log(
      `${s.id}: ${s.candidates.length} candidates (${n('listed')} listed, ${n('excluded')} excluded, ${n('new')} new), ${ha(area)} ha; ROW ${ha(s.rowM2)} ha`
    );
  }
  console.log(`wrote ${outPath}`);
  return 0;
}
