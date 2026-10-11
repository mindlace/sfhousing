import type { LayoutServerLoad } from './$types';
import { env as publicEnv } from '$env/dynamic/public';
import { requireDatasetVersion } from '$lib/server/config/dataset-version';

export const load: LayoutServerLoad = ({ platform }) => ({
  datasetVersion: requireDatasetVersion(
    platform?.env?.PUBLIC_DATASET_VERSION ?? publicEnv.PUBLIC_DATASET_VERSION
  ),
  appRelease: platform?.env?.PUBLIC_APP_RELEASE ?? publicEnv.PUBLIC_APP_RELEASE ?? 'dev'
});
