// /lesscars: universal like /sim's load, so it also runs during SSR. The page always shows the
// current dataset; every failure is a page state (no-scenario, error), never a thrown 500.
import { loadLessCars, type LessCarsPageData } from '$lib/lesscars/load';
import type { PageLoad } from './$types';

/**
 * Every state carries the datasetVersion: SvelteKit merges the page data over the layout's, and a
 * state without the layout's `datasetVersion` key would collapse to `never` in `PageData`.
 */
export type LessCarsRouteData = LessCarsPageData & { datasetVersion: string };

export const load: PageLoad = async ({ fetch, parent }): Promise<LessCarsRouteData> => {
  const { datasetVersion } = await parent();
  return { datasetVersion, ...(await loadLessCars(datasetVersion, fetch)) };
};
