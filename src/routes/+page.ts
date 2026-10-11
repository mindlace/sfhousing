// INTERIM (conductor ruling, I17 addendum): brush-tool replaces this with loadManifest
// (I16 fallback semantics) in W4. map-view only needs *a* manifest to mount.
import { manifestUrl, parseManifest } from '$lib/data/manifest';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, parent }) => {
  const { datasetVersion } = await parent();
  const res = await fetch(manifestUrl(datasetVersion));
  if (!res.ok) throw new Error(`manifest ${res.status}`);
  return { manifest: parseManifest(await res.json()) };
};
