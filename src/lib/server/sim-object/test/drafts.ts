import { newId } from '$lib/ids/base58';
import {
  NAME_KEY,
  SHAPES_REVISION,
  diff,
  type CommitDraft,
  type Ruleset,
  type RulesetContent
} from '$lib/sim-log';

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

/** A rename as the Worker drafts it for appendAs: no parent, no dataset version (the tip's). */
export function serverDraft(
  name: string,
  over: Partial<CommitDraft> = {}
): Omit<CommitDraft, 'parent' | 'datasetVersion'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { parent, datasetVersion, ...draft } = nameDraft(0, name, over);
  return draft;
}

/** A commit taking `from` to `target` (diff, R8), or null when they are equal. */
export function draftTo(from: Ruleset, target: RulesetContent, parent: number): CommitDraft | null {
  const to: Ruleset = { ...target, datasetVersion: 'fixture-0' };
  const changes = diff(from, to);
  if (changes.length === 0) return null;
  return { ...nameDraft(parent, 'unused'), label: 'Edit', source: 'sim.test', changes };
}
