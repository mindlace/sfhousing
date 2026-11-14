import { loadSharedDoc } from '$lib/server/sharing/shared-page';
import { SIM_SERVER_CODEC4 } from '$lib/timeline/server-codec';
import type { PageServerLoad } from './$types';

// A published /sim policy (plan 5, Task 6), as /p/[id] loads a plan: a plan id redirects (308) to
// /p/<id>, a bad or missing id is a 404 and an unparsable body a 500, in the policy wording. The
// server validates the stored text and hands it on; the universal load opens it (R-4).
export const load: PageServerLoad = async ({ params, platform, parent, setHeaders }) => {
  const { datasetVersion } = await parent();
  const data = await loadSharedDoc(SIM_SERVER_CODEC4, {
    id: params.id,
    platform,
    current: datasetVersion
  });
  // Set only on success, so an error page is not cached by this header; `private` as /p/[id]
  // (conductor ruling DC: adapter-cloudflare edge-caches public responses).
  setHeaders({ 'cache-control': 'private, max-age=300' });
  return data;
};
