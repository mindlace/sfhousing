// I16: the editor page loads the plan's manifest (falling back to current on a 404) once, and
// hands the same object to SimMap and the worker host.
import { error } from '@sveltejs/kit';
import { emptyPlan, type Plan } from '$lib/plan';
import { loadManifest } from '$lib/sim/manifest';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, parent }) => {
  const { datasetVersion } = await parent();
  let plan: Plan;
  try {
    plan = emptyPlan(datasetVersion); // plan-sharing (W5) will supply the autosaved plan here
  } catch {
    error(500, 'Invalid dataset version');
  }
  try {
    const { manifest, fellBack } = await loadManifest(plan.datasetVersion, datasetVersion, fetch);
    return { plan, manifest, fellBack, manifestError: false };
  } catch (e) {
    console.error('[brush] manifest load failed', e);
    return { plan, manifest: null, fellBack: false, manifestError: true };
  }
};
