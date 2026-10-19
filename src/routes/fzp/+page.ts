// /fzp (spec §4.1): universal like the editor's load, so it also runs during SSR. The page always
// uses the current dataset (no plan, no I16 fallback). Failures are flags, never a thrown 500.
import type { Manifest } from '$lib/data/manifest';
import { fetchCalibration } from '$lib/fzp/load';
import { parseSeed } from '$lib/fzp/seed';
import { loadManifest } from '$lib/sim/manifest';
import type { Calibration } from '$lib/timelapse/types';
import type { PageLoad } from './$types';

export type FzpPageData = {
  manifest: Manifest | null;
  manifestError: boolean;
  calibration: Calibration | null;
  calibrationError: boolean;
  noScenario: boolean;
  seed: number | null;
  seedInvalid: boolean;
};

export const load: PageLoad = async ({ fetch, parent, url }): Promise<FzpPageData> => {
  const { datasetVersion } = await parent();
  const { seed, invalid: seedInvalid } = parseSeed(url.searchParams);
  const none = { calibration: null, calibrationError: false, seed, seedInvalid };

  let manifest: Manifest;
  try {
    manifest = (await loadManifest(datasetVersion, datasetVersion, fetch)).manifest;
  } catch (e) {
    console.error('[fzp] manifest load failed', e);
    return { manifest: null, manifestError: true, noScenario: false, ...none };
  }
  const fzp = manifest.scenarios?.fzp;
  if (!fzp) return { manifest, manifestError: false, noScenario: true, ...none };
  try {
    const calibration = await fetchCalibration(fzp.calibration, fetch);
    return { ...none, manifest, manifestError: false, calibration, noScenario: false };
  } catch (e) {
    console.error('[fzp] calibration load failed', e);
    return { ...none, manifest, manifestError: false, calibrationError: true, noScenario: false };
  }
};
