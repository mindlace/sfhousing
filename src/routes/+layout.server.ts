import type { LayoutServerLoad } from './$types';
import { env as publicEnv } from '$env/dynamic/public';

export const load: LayoutServerLoad = ({ platform }) => ({
  datasetVersion:
    platform?.env?.PUBLIC_DATASET_VERSION ?? publicEnv.PUBLIC_DATASET_VERSION ?? 'fixture-0',
  appRelease: platform?.env?.PUBLIC_APP_RELEASE ?? publicEnv.PUBLIC_APP_RELEASE ?? 'dev'
});
