import type { LayoutServerLoad } from './$types';
import { dev } from '$app/environment';
import { env as publicEnv } from '$env/dynamic/public';
import { devOverride, resolveDatasetVersion } from '$lib/server/config/dataset-version';
import { enabledAuthMethods } from '$lib/server/auth/methods';
import { getDb } from '$lib/server/db';
import { isKnownDevice, markKnownDevice } from '$lib/server/onboarding/known-device';
import { userHasPasskey } from '$lib/server/user-store/passkey';

export const load: LayoutServerLoad = ({ platform, locals, cookies }) => {
  const data = {
    datasetVersion: resolveDatasetVersion({
      built: __SFH_DATASET_VERSION__,
      override: devOverride(platform?.env) ?? publicEnv.PUBLIC_DATASET_VERSION,
      development: dev || platform?.env?.ENVIRONMENT === 'development'
    }),
    appRelease: platform?.env?.PUBLIC_APP_RELEASE ?? publicEnv.PUBLIC_APP_RELEASE ?? 'dev',
    user: locals?.user ?? null,
    // Whether any sign-in method is in effect (none without a mail provider, unless another
    // method is listed): the header offers Sign in only then.
    signInAvailable: enabledAuthMethods({ platform, cookies }).size > 0
  };
  // Signed out, or no session: nothing to refresh, and nothing async (a malformed dataset
  // override still throws synchronously above).
  if (!locals?.user || !locals.session) return data;
  return refreshKnownDevice(platform!, locals.user, locals.session.userId, cookies).then(
    () => data
  );
};

/** Mark the device known whenever a durable credential is present: the account is not
 *  pseudonymous, or it has a passkey. */
async function refreshKnownDevice(
  platform: App.Platform,
  user: { pseudonymous: boolean },
  liveUserId: string,
  cookies: Parameters<typeof isKnownDevice>[0]
): Promise<void> {
  const hasPasskey = await userHasPasskey(getDb(platform), liveUserId);
  if ((!user.pseudonymous || hasPasskey) && !isKnownDevice(cookies)) markKnownDevice(cookies);
}
