// Main-thread I16 loader. Its result goes to both map-view (SimMap) and the worker host (init).
import { DATASET_VERSION_RE } from '$lib/data/dataset-version';
import { manifestUrl, parseManifest, type Manifest } from '$lib/data/manifest';

type FetchFn = (url: string) => Promise<Response>;

async function fetchManifest(version: string, fetchFn: FetchFn): Promise<Manifest | 404> {
  const res = await fetchFn(manifestUrl(version));
  if (res.status === 404) return 404;
  if (!res.ok) throw new Error(`manifest ${version}: HTTP ${res.status}`);
  const m = parseManifest(await res.json());
  if (m.datasetVersion !== version)
    throw new Error(`manifest ${version}: datasetVersion is ${m.datasetVersion}`);
  return m;
}

/**
 * Fetches /data/${planVersion}/manifest.json; on 404 fetches /data/${currentVersion}/manifest.json
 * (fellBack: true). Any other failure (network, 5xx, invalid, both 404) rejects.
 */
export async function loadManifest(
  planVersion: string,
  currentVersion: string,
  fetchFn: FetchFn = (u) => fetch(u)
): Promise<{ manifest: Manifest; fellBack: boolean }> {
  if (!DATASET_VERSION_RE.test(currentVersion))
    throw new Error(`invalid current datasetVersion ${JSON.stringify(currentVersion)}`);
  if (DATASET_VERSION_RE.test(planVersion)) {
    const own = await fetchManifest(planVersion, fetchFn);
    if (own !== 404) return { manifest: own, fellBack: false };
    if (planVersion === currentVersion) throw new Error(`manifest ${planVersion}: HTTP 404`);
  }
  const cur = await fetchManifest(currentVersion, fetchFn);
  if (cur === 404) throw new Error(`manifest ${currentVersion}: HTTP 404`);
  return { manifest: cur, fellBack: true };
}
