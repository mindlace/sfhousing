import { newId } from '$lib/ids/base58';
import type { Database } from '$lib/server/db';
import type { ServerAppend } from '$lib/server/sim-object/log-host';
import { loggable, type ServerAppendResult } from '$lib/server/sim-object/object-rules';
import { headerTitle } from '$lib/server/sim-object/open-params';
import { NAME_KEY, SHAPES_REVISION, type CommitDraft } from '$lib/sim-log';
import { getSimTitle } from './sim-index';

/** Why a rename did not land, as the action maps it to a status and a line. */
export type RenameCode = 'unavailable' | 'gone' | 'limit' | 'full' | 'failed';

/** What renameSim needs of the sim's object: its server-side append. */
export type AppendAsStub = {
  appendAs(input: Omit<ServerAppend, 'now'>): Promise<ServerAppendResult>;
};

/** The name commit's draft: a set of the sim's name, source 'sim.name'. Parent and dataset
 *  version are left to the object, which takes them from the tip. */
export function renameDraft(
  name: string,
  build: string
): Omit<CommitDraft, 'parent' | 'datasetVersion'> {
  return {
    id: newId(),
    kind: 'edit',
    label: 'Rename',
    restores: null,
    shapes: SHAPES_REVISION,
    build,
    source: 'sim.name',
    changes: [{ op: 'set', key: NAME_KEY, field: 'name', value: name }]
  };
}

/**
 * Append the name commit as `actor`, who the caller checked is a writer. `name` is already
 * checked (checkSimTitle); the object checks it again. Writes no D1 row: the object's index
 * pass, which appendAs awaits, copies the folded name to `sim_index.title`. On a sim with no
 * commits the object first records its start commit, titled from the current index title.
 */
export async function renameSim(args: {
  db: Database;
  stub: AppendAsStub | null;
  simId: string;
  actor: string;
  name: string;
  stamp: { datasetVersion: string; build: string };
}): Promise<{ ok: true } | { ok: false; code: RenameCode }> {
  const { db, stub, simId, actor, name, stamp } = args;
  if (!stub) return { ok: false, code: 'unavailable' };
  let out: ServerAppendResult;
  try {
    const title = await getSimTitle({ db, simId });
    if (title === null) return { ok: false, code: 'gone' };
    out = await stub.appendAs({
      actor,
      draft: renameDraft(name, stamp.build),
      start: {
        id: newId(),
        title: headerTitle(title),
        datasetVersion: stamp.datasetVersion,
        build: stamp.build
      }
    });
  } catch (e) {
    console.error('[rename] failed', simId, loggable(e));
    return { ok: false, code: 'failed' };
  }
  if (out.kind === 'accepted') return { ok: true };
  const why = out.kind === 'duplicate' ? 'duplicate' : out.why;
  if (why === 'limit' || why === 'full' || why === 'gone') return { ok: false, code: why };
  // A reason the person cannot act on: the sim id and the reason code only.
  console.error('[rename] refused', simId, why);
  return { ok: false, code: 'failed' };
}
