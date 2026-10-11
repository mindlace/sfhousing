// I16: the shared view renders against the plan's own dataset version when its manifest exists,
// else the current one; the same manifest object goes to SimMap and the worker host.
import { loadManifest } from '$lib/sim/manifest';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ data, fetch }) => {
  try {
    const { manifest, fellBack } = await loadManifest(
      data.plan.datasetVersion,
      data.currentDatasetVersion,
      fetch
    );
    return { ...data, manifest, fellBack, manifestError: false };
  } catch (e) {
    console.error('[sharing] manifest load failed', e);
    return { ...data, manifest: null, fellBack: false, manifestError: true };
  }
};
