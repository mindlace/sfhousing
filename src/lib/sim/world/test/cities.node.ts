// Node only: reads files. Every city comes back without `finance` and is memoised per process.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseManifest } from '$lib/data/manifest';
import { synthCity } from '$lib/sim/scenario/fixtures/synth-city';
import { buildSimInput } from '$lib/sim/scenario/input';
import { loadScenario, scenarioUrls } from '$lib/sim/scenario/load';
import type { SimInput } from '$lib/sim/scenario/types';
import { parseCalibration } from '$lib/timelapse/model';
import { parseProjectsFile } from '$lib/timelapse/projects';

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const FIXTURE_DIR = join(ROOT, 'e2e/fixtures/data/fixture-0');

const without = (input: SimInput): SimInput => {
  const { finance: _finance, ...rest } = input;
  void _finance;
  return rest;
};

let bench: SimInput | null = null;

/** The 150k-lot synthetic city. */
export function benchInput(): SimInput {
  if (!bench) {
    const city = synthCity();
    bench = without(
      buildSimInput({
        parcels: city.parcels,
        projects: parseProjectsFile(structuredClone(city.projects)),
        calibration: parseCalibration(structuredClone(city.calibration))
      })
    );
  }
  return bench;
}

const loaded = new Map<string, Promise<SimInput>>();

/** A dataset directory loaded through `loadScenario` with file-backed fetches. */
export function liveInput(dir: string): Promise<SimInput> {
  let hit = loaded.get(dir);
  if (!hit) {
    hit = readDir(dir);
    loaded.set(dir, hit);
  }
  return hit;
}

async function readDir(dir: string): Promise<SimInput> {
  const manifest = parseManifest(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')));
  const prefix = `/data/${manifest.datasetVersion}/`;
  const pathOf = (url: string) => join(dir, url.slice(prefix.length));
  const urls = scenarioUrls(manifest);
  if (!urls) throw new Error(`no scenarios.fzp in ${dir}`);
  const result = await loadScenario(
    {
      fetch: async (url: string) => ({
        ok: true,
        status: 200,
        json: async () => JSON.parse(readFileSync(pathOf(url), 'utf8'))
      }),
      fetchBytes: async (url: string) => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => {
          const b = readFileSync(pathOf(url));
          return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
        }
      }),
      setTimeout: (fn: () => void, t: number) => setTimeout(fn, t),
      retryDelaysMs: [],
      warn: () => {}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    urls,
    () => false
  );
  if (!('fzp' in result)) throw new Error(`load failed in ${dir}: ${JSON.stringify(result)}`);
  return without(result.fzp);
}

/** The e2e fixture dataset (fixture-0). */
export function fixtureInput(): Promise<SimInput> {
  return liveInput(FIXTURE_DIR);
}

/** `SFH_WORLD_LIVE`, else the newest non-fixture dataset under `pipeline/out/`, else null. */
export function liveDir(): string | null {
  const env = process.env.SFH_WORLD_LIVE;
  if (env) return env;
  const out = join(ROOT, 'pipeline/out');
  if (!existsSync(out)) return null;
  let best: { dir: string; t: number } | null = null;
  for (const name of readdirSync(out)) {
    if (/^fixture-\d+$/.test(name)) continue;
    const dir = join(out, name);
    const manifest = join(dir, 'manifest.json');
    if (!existsSync(manifest)) continue;
    const t = statSync(manifest).mtimeMs;
    if (!best || t > best.t) best = { dir, t };
  }
  return best ? best.dir : null;
}
