import { loadSharedPlan } from '$lib/server/sharing/shared-page';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, platform, parent, setHeaders }) => {
  const { datasetVersion } = await parent();
  const data = await loadSharedPlan({ id: params.id, platform, current: datasetVersion });
  // Set only on success, so an error page is not cached by this header.
  setHeaders({ 'cache-control': 'public, max-age=300' });
  return data;
};
