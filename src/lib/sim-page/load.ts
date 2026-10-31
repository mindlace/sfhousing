// The /sim scenario load (spec §4.1, plan 5 Call 19), shared by /sim and /s/<id>: the manifest
// (I16: `version`'s, falling back to `current` when it is gone), then, when it names a scenario,
// the calibration. Failures are flags, never a thrown 500.
import type { Manifest } from '$lib/data/manifest';
import { fetchCalibration } from '$lib/fzp/load';
import { loadManifest } from '$lib/sim/manifest';
import type { Calibration } from '$lib/timelapse/types';

type FetchFn = (url: string) => Promise<Response>;

/** What the scenario load gives, before the URL's seed. */
export type SimScenarioData = {
  manifest: Manifest | null;
  manifestError: boolean;
  calibration: Calibration | null;
  calibrationError: boolean;
  noScenario: boolean;
};

export type FzpPageData = SimScenarioData & {
  seed: number | null;
  seedInvalid: boolean;
};

/** The /sim load's data: the scenario, the URL's seed and `start`. */
export type SimPageData = FzpPageData & { start: 'fzp' | null };

/**
 * The manifest of `version` (or of `current` when that 404s: `fellBack`) and its calibration.
 * The seed is the caller's (it reads the URL).
 */
export async function loadSimScenario(
  version: string,
  current: string,
  fetchFn: FetchFn
): Promise<SimScenarioData & { fellBack: boolean }> {
  const none = { calibration: null, calibrationError: false, fellBack: false };
  let manifest: Manifest;
  let fellBack: boolean;
  try {
    ({ manifest, fellBack } = await loadManifest(version, current, fetchFn));
  } catch (e) {
    console.error('[sim] manifest load failed', e);
    return { ...none, manifest: null, manifestError: true, noScenario: false };
  }
  const fzp = manifest.scenarios?.fzp;
  if (!fzp) return { ...none, manifest, manifestError: false, noScenario: true, fellBack };
  try {
    const calibration = await fetchCalibration(fzp.calibration, fetchFn);
    return { ...none, manifest, manifestError: false, calibration, noScenario: false, fellBack };
  } catch (e) {
    console.error('[sim] calibration load failed', e);
    return {
      ...none,
      manifest,
      manifestError: false,
      calibrationError: true,
      noScenario: false,
      fellBack
    };
  }
}
