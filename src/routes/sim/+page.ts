// /sim (spec §4.1, the /fzp load moved): universal like the editor's load, so it also runs during
// SSR. The page always uses the current dataset (no plan, no I16 fallback). Failures are flags,
// never a thrown 500. The URL names no future (`?seed=` is retired; SimRoute drops it).
import { loadSimScenario, type SimPageData } from '$lib/sim-page/load';
import type { PageLoad } from './$types';

export type { SimPageData } from '$lib/sim-page/load';

export const load: PageLoad = async ({ fetch, parent }): Promise<SimPageData> => {
  const { datasetVersion } = await parent();
  const { fellBack: _current, ...scenario } = await loadSimScenario(
    datasetVersion,
    datasetVersion,
    fetch
  );
  return scenario;
};
