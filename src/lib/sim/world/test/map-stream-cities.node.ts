// Node only: the parcel chunk records of the test cities, read from files or the bench builder.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseManifest } from '$lib/data/manifest';
import type { ParcelRecord } from '$lib/data/parcel';
import { decodeParcelChunk } from '$lib/data/parcel-chunk';
import { synthCity } from '$lib/sim/scenario/fixtures/synth-city';

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const FIXTURE_DIR = join(ROOT, 'e2e/fixtures/data/fixture-0');

let bench: ParcelRecord[] | null = null;

/** Every chunk record of the bench city (`synthCity().chunks`), memoised per process. */
export function benchRecords(): ParcelRecord[] {
  if (!bench) bench = [...synthCity().chunks.values()].flatMap((c) => decodeParcelChunk(c));
  return bench;
}

const byDir = new Map<string, ParcelRecord[]>();

/** Every chunk record of a dataset directory (`manifest.chunks[].url`), memoised per directory. */
export function dirRecords(dir: string): ParcelRecord[] {
  let hit = byDir.get(dir);
  if (!hit) {
    const manifest = parseManifest(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
    const prefix = `/data/${manifest.datasetVersion}/`;
    hit = manifest.chunks.flatMap((c) =>
      decodeParcelChunk(readFileSync(join(dir, c.url.slice(prefix.length)), 'utf8'))
    );
    byDir.set(dir, hit);
  }
  return hit;
}

/** Every chunk record of the e2e fixture dataset (fixture-0). */
export function fixtureRecords(): ParcelRecord[] {
  return dirRecords(FIXTURE_DIR);
}
