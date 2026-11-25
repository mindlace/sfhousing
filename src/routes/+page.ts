import { error } from '@sveltejs/kit';
import { emptyPlan, type Plan } from '$lib/plan';
import { loadSimScenario, type SimPageData } from '$lib/sim-page/load';
import type { PageLoad } from './$types';

/** The opening's plan and the simulation's scenario: one manifest, then the calibration. */
export type HomeData = SimPageData & { plan: Plan };

export const load: PageLoad = async ({ fetch, parent }): Promise<HomeData> => {
  const { datasetVersion } = await parent();
  let plan: Plan;
  try {
    // The autosaved plan is restored in the opening's onMount (localStorage is client-only and
    // this load also runs during SSR); it is always rebased to current, so this manifest fits.
    plan = emptyPlan(datasetVersion);
  } catch {
    error(500, 'Invalid dataset version');
  }
  const { fellBack: _current, ...scenario } = await loadSimScenario(
    datasetVersion,
    datasetVersion,
    fetch
  );
  return { plan, ...scenario };
};
