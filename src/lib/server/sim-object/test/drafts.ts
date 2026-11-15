import { newId } from '$lib/ids/base58';
import { NAME_KEY, SHAPES_REVISION, type CommitDraft } from '$lib/sim-log';

/** A valid edit that sets the sim's name. */
export function nameDraft(
  parent: number,
  name: string,
  over: Partial<CommitDraft> = {}
): CommitDraft {
  return {
    id: newId(),
    parent,
    kind: 'edit',
    label: 'Rename',
    restores: null,
    datasetVersion: 'fixture-0',
    shapes: SHAPES_REVISION,
    build: 'test',
    source: 'sim.name',
    changes: [{ op: 'set', key: NAME_KEY, field: 'name', value: name }],
    ...over
  };
}
