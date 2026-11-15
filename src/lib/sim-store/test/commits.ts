/** Builders for the store's tests (local log, authoring, the store). Not part of the store. */
import { newId } from '$lib/ids/base58';
import {
  LogError,
  LogFormatError,
  LogState,
  NAME_KEY,
  SHAPES_REVISION,
  parseCommitDraft,
  type Change,
  type Commit,
  type CommitDraft
} from '$lib/sim-log';
import type { Align } from '../types';

export const DS = 'fixture-0';

/** An edit draft with a fresh id, DS, SHAPES_REVISION, build 'test', source 'sim.test'. */
export function draftOf(
  parent: number,
  changes: Change[],
  over: Partial<CommitDraft> = {}
): CommitDraft {
  return {
    id: newId(),
    parent,
    kind: 'edit',
    label: 'Edit',
    restores: null,
    datasetVersion: DS,
    shapes: SHAPES_REVISION,
    build: 'test',
    source: 'sim.test',
    changes,
    ...over
  };
}

/** The draft as the object stores it at `seq` (parent seq - 1, actor, at = seq, a 64-hex hash). */
export function stamped(d: CommitDraft, seq: number, actor = 'tester'): Commit {
  return {
    ...structuredClone(d),
    parent: seq - 1,
    seq,
    actor,
    at: seq,
    hash: seq.toString(16).padStart(64, '0')
  };
}

export const nameChange = (name: string): Change => ({
  op: 'set',
  key: NAME_KEY,
  field: 'name',
  value: name
});

/** A test Align: to a dataset in `known`, the name gets the suffix ` @<to>` once; else null. */
export function renamingAlign(known: readonly string[]): Align {
  return (content, to) => {
    if (!known.includes(to)) return null;
    const suffix = ` @${to}`;
    return content.name.endsWith(suffix) ? content : { ...content, name: content.name + suffix };
  };
}

/** The object's append rules that matter here: duplicate, behind, invalid (check), accepted. */
export class FakeObject {
  readonly commits: Commit[] = [];
  #state = LogState.empty();

  append(
    d: CommitDraft
  ):
    | { kind: 'accepted'; commit: Commit }
    | { kind: 'duplicate' }
    | { kind: 'refused'; why: 'behind' | 'invalid' } {
    let draft: CommitDraft;
    try {
      draft = parseCommitDraft(structuredClone(d));
    } catch (e) {
      if (e instanceof LogFormatError) return { kind: 'refused', why: 'invalid' };
      throw e;
    }
    if (this.commits.some((c) => c.id === draft.id)) return { kind: 'duplicate' };
    if (draft.parent !== this.commits.length) return { kind: 'refused', why: 'behind' };
    const next = this.#state.clone();
    try {
      next.apply(draft, { check: true });
    } catch (e) {
      if (e instanceof LogError) return { kind: 'refused', why: 'invalid' };
      throw e;
    }
    const commit = stamped(draft, this.commits.length + 1);
    this.#state = next;
    this.commits.push(commit);
    return { kind: 'accepted', commit };
  }
}
