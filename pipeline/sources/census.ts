// Census and DMV sources (docs/dev/cars-data.md). Each lock id has one raw file: the San Francisco
// rows of the upstream files, as a small CSV (the TIGER entries keep the upstream zip as is). The
// Census data API needs a key, so nothing here calls it: summary files, relationship files,
// TIGER/Line and PUMS CSV come straight from www2.census.gov.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Unzip, UnzipInflate, unzipSync } from 'fflate';
import {
  ACS_TABLES,
  CENSUS_SOURCES,
  CENSUS_TABLES,
  DMV_PACKAGE_URL,
  DMV_SPEC,
  DMV_ZIP_PREFIX,
  SF_COUNTY,
  SF_COUNTY_GEOID,
  SF_STATE,
  acsSeqDir,
  acsSummaryUrl,
  censusTableOf,
  type AcsSpec,
  type CensusSpec,
  type CensusTable,
  type PumsSpec,
  type Sf3Spec,
  type TigerSpec,
  type XwalkSpec
} from '../census-config';
import type { Duck } from '../lib/duck';
import type { Http } from '../lib/http';
import { rawPath, type Lock, type LockEntry } from '../lib/lock';
import { storeBytes } from '../lib/raw';

const dec = new TextDecoder();

async function get(http: Http, url: string): Promise<Uint8Array> {
  const res = await http.get(url);
  if (res.status !== 200) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return res.body;
}

/** Lines of text bytes, without the line ending. A trailing empty line is not reported. */
function textLines(bytes: Uint8Array, each: (line: string) => void): void {
  let tail = '';
  const feed = (chunk: string) => {
    const parts = (tail + chunk).split('\n');
    tail = parts.pop() ?? '';
    for (const p of parts) each(p.endsWith('\r') ? p.slice(0, -1) : p);
  };
  feed(dec.decode(bytes));
  if (tail) each(tail.endsWith('\r') ? tail.slice(0, -1) : tail);
}

/**
 * Lines of the first member of a zip that `pick` accepts (default: the first file), streamed so a
 * 300 MB member never exists as one string.
 */
function zipLines(
  bytes: Uint8Array,
  each: (line: string) => void,
  pick: (name: string) => boolean = () => true
): void {
  const d = new TextDecoder();
  let tail = '';
  let found = false;
  const feed = (text: string, final: boolean) => {
    const parts = (tail + text).split('\n');
    tail = parts.pop() ?? '';
    for (const p of parts) each(p.endsWith('\r') ? p.slice(0, -1) : p);
    if (final && tail) {
      each(tail.endsWith('\r') ? tail.slice(0, -1) : tail);
      tail = '';
    }
  };
  const unz = new Unzip((file) => {
    if (found || file.name.endsWith('/') || !pick(file.name)) return;
    found = true;
    file.ondata = (err, chunk, final) => {
      if (err) throw err;
      feed(d.decode(chunk, { stream: !final }), final);
    };
    file.start();
  });
  unz.register(UnzipInflate);
  // Slices keep each inflated chunk small: one push of a whole zip emits one multi-GB chunk.
  const SLICE = 1 << 20;
  for (let at = 0; at < bytes.length; at += SLICE) {
    unz.push(bytes.subarray(at, at + SLICE), at + SLICE >= bytes.length);
  }
  if (bytes.length === 0) unz.push(bytes, true);
  if (!found) throw new Error('zip has no matching member');
}

const csvLine = (s: string) => s.split(',');
/**
 * An estimate, not an annotation: the summary files code "no value" as -666666666 and the other
 * -222222222 to -999999999 sentinels (a median that cannot be computed, a suppressed cell).
 */
const estimate = (n: number | undefined): n is number => n !== undefined && n > -200_000_000;

const num = (s: string | undefined): number | undefined => {
  if (s === undefined || s.trim() === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

function entry(
  spec: { id: string; label: string; homepage: string; license: string },
  o: {
    rawDir: string;
    name: string;
    url: string;
    bytes: Uint8Array;
    now: Date;
    upstreamVersion: string;
    rowCount: number;
  }
): LockEntry {
  return {
    id: spec.id,
    files: [storeBytes(o.rawDir, o.name, o.url, o.bytes)],
    retrievedAt: o.now.toISOString(),
    upstreamVersion: o.upstreamVersion,
    rowCount: o.rowCount,
    license: spec.license,
    label: spec.label,
    homepage: spec.homepage
  };
}

const csvBytes = (header: string, rows: string[]) =>
  new TextEncoder().encode(`${header}\n${rows.join('\n')}\n`);

// ---- ACS block-group tables -------------------------------------------------------------------

/** `1500000US060750101011` (table-based GEO_ID) to its 12-digit SF block-group geoid. */
const sfGeoId = (g: string) => g.match(/^1500000US(06075\d{7})$/)?.[1];
const cellName = (table: string, i: number) => `${table}_${String(i).padStart(3, '0')}`;

/** Table-based summary files (2021 on): one pipe-delimited national file per table. */
async function acsTableBased(spec: AcsSpec, http: Http): Promise<string[]> {
  const out: string[] = [];
  for (const t of ACS_TABLES) {
    const bytes = await get(http, acsSummaryUrl(spec.endYear, t));
    let cols: (string | undefined)[] | undefined;
    textLines(bytes, (line) => {
      const f = line.split('|');
      if (!cols) {
        cols = f.map((c) =>
          c
            .match(/^(B\d+)_E(\d+)$/)
            ?.slice(1)
            .join('_')
        );
        return;
      }
      const geoid = sfGeoId(f[0]);
      if (!geoid) return;
      f.forEach((v, i) => {
        const n = num(v);
        if (cols![i] && estimate(n)) out.push(`${geoid},${cols![i]},${n}`);
      });
    });
    if (!cols) throw new Error(`${spec.id}: ${acsSummaryUrl(spec.endYear, t)} has no header`);
  }
  return out;
}

/** Sequence-based summary files (2009-2020): the lookup places each table in a sequence file. */
async function acsSequenceBased(spec: AcsSpec, http: Http): Promise<string[]> {
  const dir = acsSeqDir(spec.endYear);
  const tables = new Map<string, { seq: string; start: number; cells: number }>();
  textLines(await get(http, spec.lookupUrl!), (line) => {
    const f = csvLine(line);
    if (!(ACS_TABLES as readonly string[]).includes(f[1]) || tables.has(f[1])) return;
    const start = num(f[4]);
    const cells = parseInt(f[5] ?? '', 10);
    if (f[3]?.trim() === '' && start !== undefined && cells > 0) {
      tables.set(f[1], { seq: f[2].trim().padStart(4, '0'), start, cells });
    }
  });
  for (const t of ACS_TABLES) {
    if (!tables.has(t)) throw new Error(`${spec.id}: ${spec.lookupUrl} has no ${t}`);
  }
  // Block-group logical record numbers: the geography file lists `15000US06075…` at each.
  const bg = new Map<string, string>();
  textLines(await get(http, `${dir}/g${spec.endYear}5ca.txt`), (line) => {
    const m = line.match(/15000US(06075\d{7})/);
    if (m) bg.set(line.slice(13, 20), m[1]);
  });
  const out: string[] = [];
  for (const seq of [...new Set([...tables.values()].map((t) => t.seq))].sort()) {
    const url = `${dir}/${spec.endYear}5ca${seq}000.zip`;
    const mine = [...tables].filter(([, t]) => t.seq === seq);
    zipLines(
      await get(http, url),
      (line) => {
        const f = csvLine(line);
        const geoid = bg.get(f[5]);
        if (!geoid) return;
        for (const [table, t] of mine) {
          for (let k = 0; k < t.cells; k++) {
            const n = num(f[t.start - 1 + k]);
            if (estimate(n)) out.push(`${geoid},${cellName(table, k + 1)},${n}`);
          }
        }
      },
      (name) => /(^|\/)e\d{4}5ca/.test(name)
    );
  }
  return out;
}

async function fetchAcs(spec: AcsSpec, rawDir: string, http: Http, now: Date): Promise<LockEntry> {
  const rows =
    spec.layout === 'table' ? await acsTableBased(spec, http) : await acsSequenceBased(spec, http);
  rows.sort();
  const url =
    spec.layout === 'table'
      ? acsSummaryUrl(spec.endYear, ACS_TABLES[0])
      : `${acsSeqDir(spec.endYear)}/g${spec.endYear}5ca.txt`;
  return entry(spec, {
    rawDir,
    name: `${spec.id}.csv`,
    url,
    bytes: csvBytes('geoid,variable,estimate', rows),
    now,
    upstreamVersion: `ACS ${spec.endYear - 4}-${spec.endYear} 5-year, ${spec.layout}-based summary files, ${spec.bgVintage} block groups`,
    rowCount: rows.length
  });
}

// ---- PUMS -------------------------------------------------------------------------------------

/** A copy that does not point into the line (and its chunk) it was cut from. */
const own = (s: string): string => Buffer.from(s, 'latin1').toString('latin1');

const EMPLOYED_ESR = new Set(['1', '2', '4', '5']);

async function fetchPums(
  spec: PumsSpec,
  rawDir: string,
  http: Http,
  now: Date
): Promise<LockEntry> {
  const hh = await get(http, spec.hhUrl);
  const rows: { key: string; serial: string; line: (workers: number) => string }[] = [];
  let header: string[] | undefined;
  zipLines(
    hh,
    (line) => {
      const f = csvLine(line);
      if (!header) {
        header = f;
        return;
      }
      const at = (c: string) => f[header!.indexOf(c)] ?? '';
      const pc = spec.pumaCols.find((p) => header!.includes(p.col) && p.codes.includes(at(p.col)));
      if (!pc) return;
      const np = num(at('NP'));
      if (at('VEH') === '' || !np || np < 1) return;
      const ybl = header.includes('YBL') ? 'YBL' : 'YRBLT';
      const inc = num(at('HINCP'));
      const adj = num(at('ADJINC'));
      const incAdj = inc !== undefined && adj !== undefined ? Math.round((inc * adj) / 1e6) : '';
      const serial = own(at('SERIALNO'));
      // Plain values only: a retained substring would keep its whole 6 MB chunk alive.
      const pre = [
        at(pc.col),
        pc.vintage,
        serial,
        num(at('WGTP')) ?? '',
        num(at('VEH')) ?? '',
        num(at('MV')) ?? '',
        np
      ].join(',');
      const post = [incAdj, num(at('TEN')) ?? '', num(at(ybl)) ?? '', ybl].join(',');
      rows.push({
        key: own(`${at(pc.col)},${serial}`),
        serial,
        line: (w) => `${pre},${w},${post}`
      });
    },
    (n) => /\.csv$/i.test(n)
  );
  if (!header) throw new Error(`${spec.id}: ${spec.hhUrl} has no household file`);
  const sf = new Set(rows.map((r) => r.serial));
  // Workers per household come from the person file: WIF is blank for non-family households.
  const workers = new Map<string, number>();
  let pHeader: string[] | undefined;
  zipLines(
    await get(http, spec.personUrl),
    (line) => {
      const f = csvLine(line);
      if (!pHeader) {
        pHeader = f;
        return;
      }
      const s = f[pHeader.indexOf('SERIALNO')];
      if (sf.has(s) && EMPLOYED_ESR.has(f[pHeader.indexOf('ESR')] ?? '')) {
        workers.set(own(s), (workers.get(s) ?? 0) + 1);
      }
    },
    (n) => /\.csv$/i.test(n)
  );
  const lines = rows
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((r) => r.line(workers.get(r.serial) ?? 0));
  return entry(spec, {
    rawDir,
    name: `${spec.id}.csv`,
    url: spec.hhUrl,
    bytes: csvBytes(
      'puma,puma_vintage,serialno,wgtp,veh,mv,np,workers,hincp_adj,ten,ybl,ybl_src',
      lines
    ),
    now,
    upstreamVersion: `ACS ${spec.endYear - 4}-${spec.endYear} 5-year PUMS, household file ${spec.hhUrl.split('/').slice(-3).join('/')} with workers (ESR 1, 2, 4, 5) from ${spec.personUrl.split('/').pop()}`,
    rowCount: lines.length
  });
}

// ---- 2000 SF3 H044 ----------------------------------------------------------------------------

async function fetchSf3(spec: Sf3Spec, rawDir: string, http: Http, now: Date): Promise<LockEntry> {
  // Geography records are fixed width: SUMLEV at 8, GEOCOMP at 11, LOGRECNO at 18, STATE at 29,
  // COUNTY at 31, TRACT at 55 and BLKGRP at 61 (0-based).
  const bg = new Map<string, string>();
  zipLines(await get(http, spec.geoUrl), (l) => {
    if (
      l.slice(8, 11) === '150' &&
      l.slice(11, 13) === '00' &&
      l.slice(29, 31) === SF_STATE &&
      l.slice(31, 34) === SF_COUNTY
    ) {
      bg.set(l.slice(18, 25), `${SF_STATE}${SF_COUNTY}${l.slice(55, 61)}${l.slice(61, 62)}`);
    }
  });
  const out: string[] = [];
  zipLines(await get(http, spec.dataUrl), (line) => {
    const f = csvLine(line);
    const geoid = bg.get(f[4]);
    if (!geoid) return;
    // The matrix lists 206 cells for the segment, the files carry 216: count from the end.
    const cells = f.slice(f.length - spec.variables.length);
    cells.forEach((v, i) => {
      const n = num(v);
      if (n !== undefined) out.push(`${geoid},${spec.variables[i]},${n}`);
    });
  });
  out.sort();
  return entry(spec, {
    rawDir,
    name: `${spec.id}.csv`,
    url: spec.dataUrl,
    bytes: csvBytes('geoid,variable,value', out),
    now,
    upstreamVersion: `2000 Census SF3 segment 58 (H044), ${bg.size} block groups`,
    rowCount: out.length
  });
}

// ---- Crosswalks -------------------------------------------------------------------------------

async function fetchXwalk(
  spec: XwalkSpec,
  rawDir: string,
  http: Http,
  now: Date
): Promise<LockEntry> {
  const sums = new Map<string, [number, number]>();
  const add = (from: string, to: string, land: number, water: number) => {
    const k = `${from},${to}`;
    const s = sums.get(k) ?? [0, 0];
    s[0] += land;
    s[1] += water;
    sums.set(k, s);
  };
  const bytes = await get(http, spec.url);
  if (spec.layout === 'block') {
    // 2000 block to 2010 block, comma separated, after a header: the block group is the tract and
    // the first digit of the 4-digit block.
    let first = true;
    zipLines(bytes, (line) => {
      if (first) {
        first = false;
        return;
      }
      const f = csvLine(line.trim());
      if (f[0] !== SF_STATE || f[1] !== SF_COUNTY) return;
      add(
        `${f[0]}${f[1]}${f[2]}${f[3][0]}`,
        `${f[8]}${f[9]}${f[10]}${f[11][0]}`,
        num(f[16]) ?? 0,
        num(f[17]) ?? 0
      );
    });
  } else {
    // 2020 block group to 2010 block group, pipe separated with a BOM on the header.
    let h: string[] | undefined;
    textLines(bytes, (line) => {
      const f = line.replace(/^\uFEFF/, '').split('|');
      if (!h) {
        h = f;
        return;
      }
      const at = (c: string) => f[h!.indexOf(c)];
      const from = at('GEOID_BLKGRP_10');
      if (from?.startsWith(SF_COUNTY_GEOID)) {
        add(
          from,
          at('GEOID_BLKGRP_20'),
          num(at('AREALAND_PART')) ?? 0,
          num(at('AREAWATER_PART')) ?? 0
        );
      }
    });
    if (!h) throw new Error(`${spec.id}: ${spec.url} has no header`);
  }
  const lines = [...sums]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, [land, water]]) => `${k},${land},${water}`);
  return entry(spec, {
    rawDir,
    name: `${spec.id}.csv`,
    url: spec.url,
    bytes: csvBytes('from_geoid,to_geoid,land_m2,water_m2', lines),
    now,
    upstreamVersion: `Census ${spec.from} to ${spec.to} ${spec.layout === 'block' ? 'block' : 'block-group'} relationship file, SF rows by from block group`,
    rowCount: lines.length
  });
}

// ---- TIGER/Line -------------------------------------------------------------------------------

/** Records of a zip's .dbf whose COUNTYFP* field reads 075 (and STATEFP* 06). */
function sfDbfCount(zipBytes: Uint8Array): number {
  const files = unzipSync(zipBytes, { filter: (f) => /\.dbf$/i.test(f.name) });
  const dbf = Object.values(files)[0];
  if (!dbf) throw new Error('TIGER zip has no .dbf');
  const v = new DataView(dbf.buffer, dbf.byteOffset, dbf.byteLength);
  const n = v.getUint32(4, true);
  const headLen = v.getUint16(8, true);
  const recLen = v.getUint16(10, true);
  const fields: { name: string; len: number; at: number }[] = [];
  let at = 1;
  for (let o = 32; dbf[o] !== 0x0d && o < headLen; o += 32) {
    const name = dec.decode(dbf.subarray(o, o + 11)).replace(/\0.*$/, '');
    const len = dbf[o + 16];
    fields.push({ name, len, at });
    at += len;
  }
  const county = fields.find((f) => f.name.startsWith('COUNTYFP'));
  const state = fields.find((f) => f.name.startsWith('STATEFP'));
  if (!county) throw new Error('TIGER dbf has no COUNTYFP field');
  const text = (rec: number, f: { len: number; at: number }) =>
    dec
      .decode(dbf.subarray(headLen + rec * recLen + f.at, headLen + rec * recLen + f.at + f.len))
      .trim();
  let count = 0;
  for (let r = 0; r < n; r++) {
    if (text(r, county) === SF_COUNTY && (!state || text(r, state) === SF_STATE)) count++;
  }
  return count;
}

async function fetchTiger(
  spec: TigerSpec,
  rawDir: string,
  http: Http,
  now: Date
): Promise<LockEntry> {
  const bytes = await get(http, spec.url);
  return entry(spec, {
    rawDir,
    name: `${spec.id}.zip`,
    url: spec.url,
    bytes,
    now,
    upstreamVersion: `TIGER/Line ${spec.vintage} block groups, ${spec.url.split('/').pop()}`,
    rowCount: sfDbfCount(bytes)
  });
}

// ---- Entry points -----------------------------------------------------------------------------

/** Fetch one Census lock id into the raw cache and describe it as a lock entry. */
export async function fetchCensus(
  id: string,
  rawDir: string,
  http: Http,
  now: Date = new Date()
): Promise<LockEntry> {
  const spec: CensusSpec | undefined = CENSUS_SOURCES[id];
  if (!spec) throw new Error(`unknown census source ${id}`);
  switch (spec.kind) {
    case 'acs':
      return fetchAcs(spec, rawDir, http, now);
    case 'pums':
      return fetchPums(spec, rawDir, http, now);
    case 'sf3':
      return fetchSf3(spec, rawDir, http, now);
    case 'xwalk':
      return fetchXwalk(spec, rawDir, http, now);
    case 'tiger':
      return fetchTiger(spec, rawDir, http, now);
  }
}

/**
 * California DMV vehicle counts by ZIP: the package lists one CSV per as-of date (named
 * `m/d/yyyy …`); the entry keeps light-duty vehicles in 941xx ZIPs, summed per as-of year.
 */
export async function fetchDmv(
  rawDir: string,
  http: Http,
  now: Date = new Date()
): Promise<LockEntry> {
  const pkg = JSON.parse(dec.decode(await get(http, DMV_PACKAGE_URL))) as {
    result: {
      metadata_modified?: string;
      resources: { name: string; format: string; url: string }[];
    };
  };
  const files = pkg.result.resources
    .filter((r) => r.format.toUpperCase() === 'CSV')
    .map((r) => ({ year: Number(r.name.match(/\d{1,2}\/\d{1,2}\/(\d{4})/)?.[1]), url: r.url }))
    .filter((r) => Number.isFinite(r.year))
    .sort((a, b) => a.year - b.year);
  if (files.length === 0) throw new Error(`${DMV_PACKAGE_URL}: no dated CSV resources`);
  const sums = new Map<string, number>();
  for (const f of files) {
    let h: string[] | undefined;
    textLines(await get(http, f.url), (line) => {
      const c = csvLine(line);
      if (!h) {
        h = c.map((x) => x.trim().toLowerCase());
        return;
      }
      const zip = c[h.indexOf('zip code')];
      if (!zip?.startsWith(DMV_ZIP_PREFIX) || c[h.indexOf('duty')] !== 'Light') return;
      const n = num(c[h.indexOf('vehicles')]);
      if (n === undefined) return;
      const k = `${f.year},${zip}`;
      sums.set(k, (sums.get(k) ?? 0) + n);
    });
    if (!h) throw new Error(`${f.url}: empty file`);
  }
  const lines = [...sums]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, n]) => `${k},${n}`);
  const years = files.map((f) => f.year);
  return entry(DMV_SPEC, {
    rawDir,
    name: `${DMV_SPEC.id}.csv`,
    url: DMV_PACKAGE_URL,
    bytes: csvBytes('year,zip,light_duty', lines),
    now,
    upstreamVersion: `as-of ${years[0]} to ${years[years.length - 1]}, ${files.length} files, package modified ${pkg.result.metadata_modified ?? 'unknown'}`,
    rowCount: lines.length
  });
}

// ---- Normalisation ----------------------------------------------------------------------------

const q = (s: string) => `'${s.replaceAll("'", "''")}'`;

/** The `<table>.parquet` basename the build's norm dir holds for a census table. */
export const censusParquet = (normDir: string, t: CensusTable) =>
  path.join(normDir, `${t}.parquet`);

const readCsv = (file: string, cols: Record<string, string>) =>
  `read_csv(${q(file)}, header = true, delim = ',', quote = '"', escape = '"',
    columns = {${Object.entries(cols)
      .map(([k, v]) => `${q(k)}: ${q(v)}`)
      .join(', ')}})`;

/** Row order of each table (the geometry column is never an ordering key). */
const ORDER: Record<CensusTable, string> = {
  src_acs_bg: 'release, geoid, variable',
  src_pums_hh: 'release, puma, serialno',
  src_sf3_bg: 'geoid, variable',
  src_bg_geom: 'vintage, geoid',
  src_bg_xwalk: 'from_vintage, from_geoid, to_geoid',
  src_dmv_zip: 'year, zip'
};

/** One SELECT per lock entry of the table, in the table's column order. */
async function selectOf(
  db: Duck,
  table: CensusTable,
  e: LockEntry,
  file: string,
  scratch: string[]
): Promise<string> {
  const spec = CENSUS_SOURCES[e.id];
  switch (table) {
    case 'src_acs_bg':
      return `SELECT ${(spec as AcsSpec).endYear}::INTEGER AS release, geoid, variable, estimate
        FROM ${readCsv(file, { geoid: 'VARCHAR', variable: 'VARCHAR', estimate: 'DOUBLE' })}`;
    case 'src_pums_hh':
      return `SELECT ${(spec as PumsSpec).endYear}::INTEGER AS release, puma, serialno, wgtp, veh, mv,
        np, workers, hincp_adj, ten, ybl, puma_vintage, ybl_src
        FROM ${readCsv(file, {
          puma: 'VARCHAR',
          puma_vintage: 'INTEGER',
          serialno: 'VARCHAR',
          wgtp: 'INTEGER',
          veh: 'INTEGER',
          mv: 'INTEGER',
          np: 'INTEGER',
          workers: 'INTEGER',
          hincp_adj: 'DOUBLE',
          ten: 'INTEGER',
          ybl: 'INTEGER',
          ybl_src: 'VARCHAR'
        })}`;
    case 'src_sf3_bg':
      return `SELECT geoid, variable, value
        FROM ${readCsv(file, { geoid: 'VARCHAR', variable: 'VARCHAR', value: 'DOUBLE' })}`;
    case 'src_bg_xwalk': {
      const x = spec as XwalkSpec;
      // A block group's land area in each new block group over its land area in all of them
      // (water area when it has no land); weights per from_geoid sum to 1.
      return `SELECT ${x.from}::INTEGER AS from_vintage, from_geoid, ${x.to}::INTEGER AS to_vintage,
        to_geoid, w AS weight FROM (
          SELECT from_geoid, to_geoid,
            CASE WHEN sum(land_m2) OVER (PARTITION BY from_geoid) > 0
              THEN land_m2 / sum(land_m2) OVER (PARTITION BY from_geoid)
              ELSE water_m2 / NULLIF(sum(water_m2) OVER (PARTITION BY from_geoid), 0) END AS w
          FROM ${readCsv(file, { from_geoid: 'VARCHAR', to_geoid: 'VARCHAR', land_m2: 'DOUBLE', water_m2: 'DOUBLE' })})
        WHERE w > 0`;
    }
    case 'src_dmv_zip':
      return `SELECT year, zip, light_duty
        FROM ${readCsv(file, { year: 'INTEGER', zip: 'VARCHAR', light_duty: 'INTEGER' })}`;
    case 'src_bg_geom': {
      const t = spec as TigerSpec;
      // The zip is the upstream file; unpack it to a scratch dir so ST_Read finds the shapefile.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfh-tiger-'));
      scratch.push(dir);
      const members = unzipSync(fs.readFileSync(file));
      let shp = '';
      for (const [name, data] of Object.entries(members)) {
        const dest = path.join(dir, path.basename(name));
        fs.writeFileSync(dest, data);
        if (/\.shp$/i.test(dest)) shp = dest;
      }
      if (!shp) throw new Error(`${e.id}: no .shp in the zip`);
      const cols = (
        await db.all<{ column_name: string }>(`DESCRIBE SELECT * FROM ST_Read(${q(shp)})`)
      ).map((c) => c.column_name);
      // 2000 block groups have no GEOID00: BKGPIDFP00 is the same 12 digits.
      const geoid = cols.find((c) => /^GEOID/i.test(c)) ?? cols.find((c) => /^BKGPIDFP/i.test(c));
      const county = cols.find((c) => /^COUNTYFP/i.test(c));
      if (!geoid || !county) throw new Error(`${e.id}: shapefile lacks GEOID or COUNTYFP`);
      return `SELECT ${t.vintage}::INTEGER AS vintage, "${geoid}"::VARCHAR AS geoid,
        ST_Transform(geom, 'EPSG:4269', 'EPSG:7131', always_xy := true) AS geom
        FROM ST_Read(${q(shp)}) WHERE "${county}" = ${q(SF_COUNTY)}`;
    }
  }
}

/**
 * Normalise every census lock entry into `<normDir>/<table>.parquet`, one file per table that has
 * entries; a table with none gets no file (and a stale one is removed). Returns row counts by
 * table. Unlike OPTIONAL_SOURCE_IDS' empty tables, absence is observable: the consumers return
 * nothing when the table is missing.
 */
export async function normaliseCensus(
  db: Duck,
  lock: Lock,
  rawDir: string,
  normDir: string,
  byName = false
): Promise<Partial<Record<CensusTable, number>>> {
  const counts: Partial<Record<CensusTable, number>> = {};
  fs.mkdirSync(normDir, { recursive: true });
  for (const table of CENSUS_TABLES) {
    const out = censusParquet(normDir, table);
    const entries = lock.sources
      .filter((s) => censusTableOf(s.id) === table)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    if (entries.length === 0) {
      fs.rmSync(out, { force: true });
      continue;
    }
    const scratch: string[] = [];
    try {
      const selects: string[] = [];
      for (const e of entries) {
        selects.push(
          await selectOf(db, table, e, path.resolve(rawPath(rawDir, e.files[0], byName)), scratch)
        );
      }
      await db.run(
        `COPY (SELECT * FROM (${selects.join('\nUNION ALL\n')}) ORDER BY ${ORDER[table]}) TO ${q(out)} (FORMAT parquet)`
      );
    } finally {
      for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
    }
    const [r] = await db.all<{ n: number }>(`SELECT count(*) n FROM read_parquet(${q(out)})`);
    counts[table] = r.n;
  }
  return counts;
}

/** CREATE TABLE for each census table whose parquet exists; DROP the others. */
export async function loadCensus(db: Duck, normDir: string): Promise<void> {
  for (const table of CENSUS_TABLES) {
    const file = censusParquet(normDir, table);
    if (fs.existsSync(file)) {
      await db.run(`CREATE OR REPLACE TABLE ${table} AS SELECT * FROM read_parquet(${q(file)})`);
    } else {
      await db.run(`DROP TABLE IF EXISTS ${table}`);
    }
  }
}
