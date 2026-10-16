// `npm run data:transit` (transit spec §4.1): fetch Muni, BART and Caltrain GTFS straight from the
// agencies, build transit.json and add it to the local R2 copy of the dataset in .dev.vars.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATASET_VERSION_RE, parseManifest } from '../src/lib/data/manifest';
import { readLock } from '../pipeline/lib/lock';
import { wranglerTarget } from '../pipeline/lib/r2';
import { fetchAll } from '../pipeline/steps/fetch';
import { writeTransit } from '../pipeline/steps/transit';
import { GTFS_IDS } from '../pipeline/transit-config';
import { devVarsVersion, lockDrift, withTransit } from './lib/data-transit-helpers';
import { putLocal } from './r2-put-local';

const ROOT = resolve(import.meta.dirname, '..');

async function main(): Promise<number> {
  const version =
    process.argv[2] ??
    (existsSync(join(ROOT, '.dev.vars'))
      ? devVarsVersion(readFileSync(join(ROOT, '.dev.vars'), 'utf8'))
      : null);
  if (!version || !DATASET_VERSION_RE.test(version)) {
    console.error('usage: npm run data:transit [-- <datasetVersion>] (default: .dev.vars)');
    return 2;
  }
  const work = mkdtempSync(join(tmpdir(), 'sfh-transit-'));
  try {
    const lockPath = join(work, 'transit.lock.json');
    const rawDir = join(ROOT, 'pipeline/.cache/raw');
    const code = await fetchAll({ only: GTFS_IDS.join(','), lockPath, rawDir });
    if (code !== 0) return code;
    const fetched = readLock(lockPath);
    const committedPath = join(ROOT, 'pipeline/sources.lock.json');
    if (existsSync(committedPath))
      for (const w of lockDrift(readLock(committedPath), fetched)) console.warn(`warning: ${w}`);
    const r2 = wranglerTarget({ local: true });
    for (const f of ['manifest.json', 'neighborhoods.geojson']) {
      if (!(await r2.get(`data/${version}/${f}`, join(work, f)))) {
        console.error(
          `data/${version}/${f} is not in local R2: load the dataset first (npm run data:fixture or data:local)`
        );
        return 1;
      }
    }
    const r = writeTransit({
      lock: fetched,
      rawDir,
      byName: false,
      outDir: work,
      targetDate: new Date().toISOString().slice(0, 10),
      strict: false
    });
    for (const w of r.warnings) console.warn(`warning: ${w}`);
    const manifest = withTransit(
      parseManifest(JSON.parse(readFileSync(join(work, 'manifest.json'), 'utf8')))
    );
    writeFileSync(join(work, 'manifest.json'), JSON.stringify(manifest));
    putLocal(version, 'transit.json', join(work, 'transit.json'));
    putLocal(version, 'manifest.json', join(work, 'manifest.json'));
    rmSync(join(ROOT, '.wrangler/state/v3/cache'), { recursive: true, force: true });
    console.log(
      `transit.json (${r.bytes} B, ${r.counts['transit.stops']} stops) added to local data/${version}/`
    );
    return 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(e instanceof Error ? (e.stack ?? e.message) : e);
      process.exit(1);
    }
  );
}
