import type { LayoutServerLoad } from './$types';
import { dev } from '$app/environment';
import { env as publicEnv } from '$env/dynamic/public';
import { devOverride, resolveDatasetVersion } from '$lib/server/config/dataset-version';

export const load: LayoutServerLoad = ({ platform }) => ({
  datasetVersion: resolveDatasetVersion({
    built: __SFH_DATASET_VERSION__,
    override: devOverride(platform?.env) ?? publicEnv.PUBLIC_DATASET_VERSION,
    development: dev || platform?.env?.ENVIRONMENT === 'development'
  }),
  appRelease: platform?.env?.PUBLIC_APP_RELEASE ?? publicEnv.PUBLIC_APP_RELEASE ?? 'dev'
});
