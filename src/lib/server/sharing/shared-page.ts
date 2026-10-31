// Server data for the /p/:id and /s/:id read-only views (spec §4.7): loads the row directly (no
// HTTP self-call), parses it with the page's codec, and picks the dataset notice (I16).
import { error, redirect } from '@sveltejs/kit';
import type { Plan } from '$lib/plan';
import { getDb } from '$lib/server/db';
import { copyFor } from '$lib/sharing/copy';
import { PLAN_CODEC, type DocCodec } from '$lib/sharing/doc-codec';
import { PLAN_ID_RE } from '$lib/sharing/ids';
import { CODECS, otherCodec } from './codecs';
import { findPlanById } from './store';

export type DatasetNotice =
  | 'none'
  /** N5: the document's dataset version exists and differs from the current one. */
  | 'remix'
  /** N6: the document's dataset version is no longer available. */
  | 'gone';

export interface SharedDocData<D> {
  id: string;
  doc: D;
  /** ISO 8601. */
  createdAt: string;
  currentDatasetVersion: string;
  datasetNotice: DatasetNotice;
}

export interface SharedPlanData {
  id: string;
  plan: Plan;
  /** ISO 8601. */
  createdAt: string;
  currentDatasetVersion: string;
  datasetNotice: DatasetNotice;
}

/**
 * Throws SvelteKit error(404, notFoundHeading) for a bad id or missing row, a 308 redirect to
 * the other kind's page when the row belongs to it, and error(500, unparsable) for a stored body
 * the codec's lenient `load` rejects (a newer schema, or a breaking app change).
 */
export async function loadSharedDoc<D>(
  codec: DocCodec<D>,
  args: { id: string; platform: App.Platform | undefined; current: string }
): Promise<SharedDocData<D>> {
  const { id, platform, current } = args;
  const copy = copyFor(codec.kind);
  if (!PLAN_ID_RE.test(id)) error(404, copy.notFoundHeading);

  const row = await findPlanById(getDb(platform), id);
  if (!row) error(404, copy.notFoundHeading);
  if (row.kind !== codec.kind) {
    const other = CODECS[row.kind as keyof typeof CODECS];
    // Only a row of the other known kind has a page to send the visitor to.
    if (other && other === otherCodec(codec.kind)) redirect(308, other.path(id));
    error(404, copy.notFoundHeading);
  }

  const parsed = codec.load(row.body);
  if (!parsed.ok) error(500, copy.unparsable);
  const doc = parsed.value;

  let datasetNotice: DatasetNotice = 'none';
  const version = codec.datasetVersion(doc);
  if (version !== current) {
    const bucket = platform?.env?.BUCKET;
    if (!bucket) throw new Error('R2 binding BUCKET unavailable');
    const manifest = await bucket.head('data/' + version + '/manifest.json');
    datasetNotice = manifest ? 'remix' : 'gone';
  }

  return {
    id,
    doc,
    createdAt: row.createdAt.toISOString(),
    currentDatasetVersion: current,
    datasetNotice
  };
}

/** The /p/:id load: a plan, under the `plan` key its page reads. */
export async function loadSharedPlan(args: {
  id: string;
  platform: App.Platform | undefined;
  current: string;
}): Promise<SharedPlanData> {
  const { doc, ...rest } = await loadSharedDoc(PLAN_CODEC, args);
  return { ...rest, plan: doc };
}
