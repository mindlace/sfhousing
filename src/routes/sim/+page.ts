// /sim (spec §4.1, the /fzp load moved): universal like the editor's load, so it also runs during
// SSR. The page always uses the current dataset (no plan, no I16 fallback). Failures are flags,
// never a thrown 500. `start=fzp` (what /fzp's redirect adds) opens the FZP comparison.
import { parseSeed } from '$lib/fzp/seed';
import { loadSimScenario, type SimPageData } from '$lib/sim-page/load';
import type { PageLoad } from './$types';

export type { FzpPageData, SimPageData } from '$lib/sim-page/load';

export const load: PageLoad = async ({ fetch, parent, url }): Promise<SimPageData> => {
  const { datasetVersion } = await parent();
  const { seed, invalid: seedInvalid } = parseSeed(url.searchParams);
  const start: SimPageData['start'] = url.searchParams.get('start') === 'fzp' ? 'fzp' : null;
  const { fellBack: _current, ...scenario } = await loadSimScenario(
    datasetVersion,
    datasetVersion,
    fetch
  );
  return { ...scenario, seed, seedInvalid, start };
};
