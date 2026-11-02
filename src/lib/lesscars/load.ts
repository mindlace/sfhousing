// The /lesscars data the main thread needs before the playback worker starts: the dataset's
// manifest, the FZP calibration and the three scenarios/lesscars/*.json files, parsed by Plan 1's
// codec. Never throws: every failure becomes a page state.
import {
  parsePlanFile,
  parseSitesFile,
  parseSummary,
  type LessCarsPlanFile,
  type LessCarsSitesFile,
  type LessCarsSummary
} from '$lib/data/lesscars/codec';
import type { Manifest } from '$lib/data/manifest';
import { fetchCalibration } from '$lib/fzp/load';
import { loadManifest } from '$lib/sim/manifest';
import type { Calibration } from '$lib/timelapse/types';

type FetchFn = (url: string) => Promise<Response>;

export type LessCarsData = {
  manifest: Manifest;
  calibration: Calibration;
  plan: LessCarsPlanFile;
  sites: LessCarsSitesFile;
  summary: LessCarsSummary;
};

export type LessCarsPageData =
  | { state: 'ready'; data: LessCarsData }
  | { state: 'no-scenario'; datasetVersion: string }
  | { state: 'error'; datasetVersion: string; message: string };

async function fetchJson(name: string, url: string, fetchFn: FetchFn): Promise<unknown> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}

function sameVersion(name: string, file: { datasetVersion: string }, version: string): void {
  if (file.datasetVersion !== version)
    throw new Error(`${name}: datasetVersion is ${file.datasetVersion}, expected ${version}`);
}

export async function loadLessCars(
  datasetVersion: string,
  fetchFn: FetchFn
): Promise<LessCarsPageData> {
  try {
    const { manifest } = await loadManifest(datasetVersion, datasetVersion, fetchFn);
    const lc = manifest.scenarios?.lesscars;
    const fzp = manifest.scenarios?.fzp;
    if (!lc || !fzp) return { state: 'no-scenario', datasetVersion };
    const [calibration, planJson, sitesJson, summaryJson] = await Promise.all([
      fetchCalibration(fzp.calibration, fetchFn),
      fetchJson('plan.json', lc.plan, fetchFn),
      fetchJson('sites.json', lc.sites, fetchFn),
      fetchJson('summary.json', lc.summary, fetchFn)
    ]);
    const plan = parsePlanFile(planJson);
    const sites = parseSitesFile(sitesJson);
    const summary = parseSummary(summaryJson);
    sameVersion('plan.json', plan, manifest.datasetVersion);
    sameVersion('sites.json', sites, manifest.datasetVersion);
    sameVersion('summary.json', summary, manifest.datasetVersion);
    return { state: 'ready', data: { manifest, calibration, plan, sites, summary } };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[lesscars] load ${datasetVersion} failed: ${message}`);
    return { state: 'error', datasetVersion, message };
  }
}
