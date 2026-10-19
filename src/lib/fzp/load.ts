// The /fzp data the main thread needs before the worker answers (spec §4.1): the current
// dataset's manifest and, when it names a scenario, the calibration (parsed by the worker's own
// parser, T12). Used by the route load and by FzpMode's Retry (step 3).
import type { Manifest } from '$lib/data/manifest';
import { loadManifest } from '$lib/sim/manifest';
import { parseCalibration } from '$lib/timelapse/model';
import type { Calibration } from '$lib/timelapse/types';

type FetchFn = (url: string) => Promise<Response>;

/** Fetches and validates `calibration.json`; rejects on any failure. */
export async function fetchCalibration(url: string, fetchFn: FetchFn): Promise<Calibration> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`calibration: HTTP ${res.status}`);
  return parseCalibration(await res.json());
}

/** The manifest and calibration for Retry; rejects on any failure or a missing scenario. */
export async function reloadScenario(
  datasetVersion: string,
  fetchFn: FetchFn = (u) => fetch(u)
): Promise<{ manifest: Manifest; calibration: Calibration }> {
  const { manifest } = await loadManifest(datasetVersion, datasetVersion, fetchFn);
  const fzp = manifest.scenarios?.fzp;
  if (!fzp) throw new Error(`dataset ${datasetVersion} has no fzp scenario`);
  return { manifest, calibration: await fetchCalibration(fzp.calibration, fetchFn) };
}
