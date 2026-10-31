// /s/[id] (plan 5, Task 6; I16): the shared policy runs on its own dataset version when that
// manifest exists, else on the current one (Call 9). `?seed=` still works (Call 17); the link
// itself names no seed. Failures are flags, never a thrown 500, as on /sim.
import { parseSeed } from '$lib/fzp/seed';
import { loadSimScenario } from '$lib/sim-page/load';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ data, fetch, url }) => {
  const { seed, invalid: seedInvalid } = parseSeed(url.searchParams);
  const scenario = await loadSimScenario(
    data.doc.datasetVersion,
    data.currentDatasetVersion,
    fetch
  );
  // The manifest's version: the document's own, or current on fallback. With no manifest, the
  // server's notice says which one a Retry should ask for.
  const datasetVersion =
    scenario.manifest?.datasetVersion ??
    (data.datasetNotice === 'gone' ? data.currentDatasetVersion : data.doc.datasetVersion);
  return { ...data, ...scenario, seed, seedInvalid, start: null, datasetVersion };
};
