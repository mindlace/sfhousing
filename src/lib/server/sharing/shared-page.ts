// Server data for the /p/:id read-only view (spec §4.7): loads the row directly (no HTTP
// self-call), parses it, and picks the dataset version to render against (I16).
import { error } from '@sveltejs/kit';
import { parsePlan, type Plan } from '$lib/plan';
import { getDb } from '$lib/server/db';
import { COPY } from '$lib/sharing/copy';
import { PLAN_ID_RE } from '$lib/sharing/ids';
import { findPlanById } from './store';

export type DatasetNotice =
  | 'none'
  /** N5: the plan's dataset version exists and differs from the current one. */
  | 'remix'
  /** N6: the plan's dataset version is no longer available. */
  | 'gone';

export interface SharedPlanData {
  id: string;
  plan: Plan;
  /** ISO 8601. */
  createdAt: string;
  currentDatasetVersion: string;
  /** plan.datasetVersion, or the current version when the plan's is gone. */
  renderVersion: string;
  datasetNotice: DatasetNotice;
}

/**
 * Throws SvelteKit error(404, COPY.notFoundHeading) for a bad id or missing row, and
 * error(500, COPY.unparsable) for a stored body parsePlan rejects.
 */
export async function loadSharedPlan(args: {
  id: string;
  platform: App.Platform | undefined;
  current: string;
}): Promise<SharedPlanData> {
  const { id, platform, current } = args;
  if (!PLAN_ID_RE.test(id)) error(404, COPY.notFoundHeading);

  const row = await findPlanById(getDb(platform), id);
  if (!row) error(404, COPY.notFoundHeading);

  const parsed = parsePlan(row.body);
  if (!parsed.ok) error(500, COPY.unparsable);
  const plan = parsed.value;

  let datasetNotice: DatasetNotice = 'none';
  let renderVersion = plan.datasetVersion;
  if (plan.datasetVersion !== current) {
    const bucket = platform?.env?.BUCKET;
    if (!bucket) throw new Error('R2 binding BUCKET unavailable');
    const manifest = await bucket.head('data/' + plan.datasetVersion + '/manifest.json');
    if (manifest) {
      datasetNotice = 'remix';
    } else {
      datasetNotice = 'gone';
      renderVersion = current;
    }
  }

  return {
    id,
    plan,
    createdAt: row.createdAt.toISOString(),
    currentDatasetVersion: current,
    renderVersion,
    datasetNotice
  };
}
