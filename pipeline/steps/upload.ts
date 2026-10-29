import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { DATASET_VERSION_RE } from '../../src/lib/data/dataset-version';
import { parseManifest, type Manifest } from '../../src/lib/data/manifest';
import { FONT_STACKS, IMMUTABLE } from '../config';
import { lockSha256, rawPath, type Lock } from '../lib/lock';
import { contentTypeFor, type R2Target } from '../lib/r2';

const PRIVATE = 'private, no-store';
/** manifest.json is published last, separately. */
const MANIFEST = 'manifest.json';
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const FIXTURE_RE = /^fixture-\d+$/;
/** A key segment must match the platform's route contract and must not be a dotfile. */
const badKey = (key: string): boolean =>
  key.split('/').some((seg) => !SEGMENT_RE.test(seg) || seg.startsWith('.'));
export const STAGING_ORIGIN = 'https://sfhousing-staging.mindlace.net';

export interface UploadArgs {
  outDir: string;
  datasetVersion: string;
  lock: Lock;
  rawDir: string;
  target: R2Target;
  concurrency?: number;
  retries?: number;
  log?: (s: string) => void;
  /** Backoff wait; injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
    .sort();
}

/** Run `fn` over `items` with at most `n` in flight; resolves to the failures. */
async function pool<T>(
  items: T[],
  n: number,
  fn: (item: T) => Promise<void>
): Promise<{ item: T; error: unknown }[]> {
  const failures: { item: T; error: unknown }[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await fn(item);
      } catch (error) {
        failures.push({ item, error });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return failures;
}

interface BuildReport {
  invariants?: { id?: unknown; ok?: unknown }[];
  tilesSkipped?: unknown;
  lockSha256?: unknown;
}

/**
 * Spec §4.9 "any failure -> nothing uploaded": the reasons `outDir` is not a publishable
 * dataset. report.json must exist with every invariant ok and tiles built; every file the
 * manifest names (chunks, both PMTiles, neighborhoods, transit, `0-255.pbf` per font stack)
 * must exist; and for a live version the lock being archived must be the lock that built it. Fixture
 * versions (`fixture-<n>`) archive nothing and are built from the committed mini lock, so the
 * lock check is skipped for them.
 */
export function datasetProblems(outDir: string, v: string, raw: unknown, lock: Lock): string[] {
  const problems: string[] = [];
  let report: BuildReport | undefined;
  try {
    report = JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8')) as BuildReport;
  } catch (e) {
    problems.push(`cannot read ${outDir}/report.json (${(e as Error).message})`);
  }
  if (report) {
    const inv = Array.isArray(report.invariants) ? report.invariants : [];
    if (inv.length === 0) problems.push('report.json has no invariant results');
    for (const r of inv) if (r.ok !== true) problems.push(`invariant ${String(r.id)} failed`);
    if (report.tilesSkipped === undefined)
      problems.push('report.json has no tilesSkipped: rebuild');
    else if (report.tilesSkipped !== false)
      problems.push('built with --skip-tiles (V11 tiles skipped)');
    if (!FIXTURE_RE.test(v) && report.lockSha256 === undefined) {
      problems.push('report.json has no lockSha256: rebuild');
    } else if (!FIXTURE_RE.test(v) && report.lockSha256 !== lockSha256(lock)) {
      problems.push(
        `current lock (sha256 ${lockSha256(lock).slice(0, 12)}) is not the lock that built ${v} (${String(report.lockSha256).slice(0, 12)})`
      );
    }
  }
  let m: Manifest;
  try {
    m = parseManifest(raw);
  } catch (e) {
    problems.push((e as Error).message);
    return problems;
  }
  const prefix = `/data/${v}/`;
  const urls = [
    ...m.chunks.map((c) => c.url),
    m.buildingsTiles,
    m.basemapTiles,
    m.neighborhoods,
    ...(m.transit ? [m.transit] : []),
    ...(m.scenarios
      ? [m.scenarios.fzp.parcels, m.scenarios.fzp.projects, m.scenarios.fzp.calibration]
      : []),
    ...(m.scenarios?.fzp.policy ? [m.scenarios.fzp.policy] : []),
    ...(m.scenarios?.fzp.frontage ? [m.scenarios.fzp.frontage] : []),
    ...(m.sprite ? [m.sprite] : []),
    ...Object.values(FONT_STACKS).map((s) =>
      m.glyphs.replace('{fontstack}', s).replace('{range}', '0-255')
    )
  ];
  for (const u of urls) {
    const rel = u.slice(prefix.length);
    if (!u.startsWith(prefix) || !existsSync(join(outDir, rel))) {
      problems.push(`manifest names ${u} but ${outDir}/${rel} is missing`);
    }
  }
  return problems;
}

/** Spec §4.10: archives, then artifacts (8 at a time, retried), the manifest strictly last. */
export async function upload(a: UploadArgs): Promise<number> {
  const log = a.log ?? ((s: string) => console.log(s));
  const sleep = a.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const retries = a.retries ?? 3;
  const v = a.datasetVersion;
  if (!DATASET_VERSION_RE.test(v)) {
    log(`refusing to upload: invalid dataset version '${v}'`);
    return 1;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(a.outDir, 'manifest.json'), 'utf8'));
  } catch (e) {
    log(`refusing to upload: cannot read ${a.outDir}/manifest.json (${(e as Error).message})`);
    return 1;
  }
  const local = (raw as { datasetVersion?: unknown } | null)?.datasetVersion;
  if (local !== v) {
    log(`refusing to upload: ${a.outDir}/manifest.json is version '${String(local)}', not '${v}'`);
    return 1;
  }
  const problems = datasetProblems(a.outDir, v, raw, a.lock);
  if (problems.length > 0) {
    for (const p of problems) log(`refusing to upload: ${p}`);
    return 1;
  }

  const rels = walk(a.outDir)
    .map((f) => relative(a.outDir, f).split(sep).join('/'))
    .filter((r) => r !== MANIFEST);
  const bad = [
    ...rels.filter(badKey),
    ...a.lock.sources.flatMap((e) => e.files.map((f) => f.archiveKey)).filter(badKey)
  ];
  if (bad.length > 0) {
    for (const k of bad) log(`refusing to upload: invalid key segment in '${k}'`);
    return 1;
  }

  const manifestKey = `data/${v}/manifest.json`;
  if (await a.target.exists(manifestKey)) {
    log(`version ${v} already published`);
    return 1;
  }

  for (const entry of a.lock.sources) {
    for (const f of entry.files) {
      if (await a.target.exists(f.archiveKey)) continue;
      log(`archive ${f.archiveKey}`);
      await a.target.put(f.archiveKey, rawPath(a.rawDir, f), 'application/octet-stream', PRIVATE);
    }
  }

  const putWithRetry = async (rel: string) => {
    for (let attempt = 0; ; attempt++) {
      try {
        await a.target.put(`data/${v}/${rel}`, join(a.outDir, rel), contentTypeFor(rel), IMMUTABLE);
        return;
      } catch (e) {
        if (attempt >= retries) throw e;
        await sleep(200 * 2 ** attempt);
      }
    }
  };
  const failures = await pool(rels, a.concurrency ?? 8, putWithRetry);
  if (failures.length > 0) {
    for (const f of failures) log(`failed: ${f.item}: ${(f.error as Error).message}`);
    log(`${failures.length} object(s) failed; manifest NOT published`);
    return 1;
  }

  await a.target.put(
    manifestKey,
    join(a.outDir, 'manifest.json'),
    contentTypeFor('manifest.json'),
    IMMUTABLE
  );
  log(`published ${rels.length + 1} object(s) under data/${v}/`);
  log(`"PUBLIC_DATASET_VERSION": "${v}"`);
  log(`npm run pipeline -- verify ${v} --origin ${STAGING_ORIGIN}`);
  return 0;
}
