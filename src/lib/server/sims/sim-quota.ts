import type { Database } from '$lib/server/db';
import { MAX_SIMS_PER_MANAGER, SIMS_COPY } from '$lib/members/copy';
import { countSimsManagedBy } from './sim-index';

export { MAX_SIMS_PER_MANAGER, SIM_TITLE_MAX } from '$lib/members/copy';

/**
 * Per-manager sim cap, shared by every sim-creation path so none can bypass it. Returns
 * the quota copy when the user already manages the most sims they may, else null.
 */
export async function simQuotaExceeded(db: Database, user: { id: string }): Promise<string | null> {
  const owned = await countSimsManagedBy({ db, userId: user.id });
  return owned >= MAX_SIMS_PER_MANAGER ? SIMS_COPY.quota : null;
}
