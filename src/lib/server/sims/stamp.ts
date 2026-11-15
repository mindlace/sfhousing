import { dev } from '$app/environment';
import { env as publicEnv } from '$env/dynamic/public';
import { devOverride, resolveDatasetVersion } from '$lib/server/config/dataset-version';

/**
 * The dataset version and build the Worker stamps on what it hands the sim object: the open
 * header of a socket and a commit it appends on a writer's behalf. One function, so the two
 * cannot drift. Throws (a 500) when no valid dataset version resolves.
 */
export function serverStamp(platform: App.Platform | undefined): {
  datasetVersion: string;
  build: string;
} {
  return {
    datasetVersion: resolveDatasetVersion({
      built: __SFH_DATASET_VERSION__,
      override: devOverride(platform?.env) ?? publicEnv.PUBLIC_DATASET_VERSION,
      development: dev || platform?.env?.ENVIRONMENT === 'development'
    }),
    build: platform?.env?.PUBLIC_APP_RELEASE ?? publicEnv.PUBLIC_APP_RELEASE ?? 'dev'
  };
}
