import {
  LABEL_MAX,
  LogError,
  LogFormatError,
  SHAPES_REVISION,
  diff,
  parseCommitDraft,
  rulesetText,
  toLogForm,
  type Change,
  type CommitDraft,
  type Restores,
  type RulesetContent
} from '$lib/sim-log';
import { LIMITS, fitsCommit, utf8Bytes, type Limits } from '$lib/sim-stream/limits';
import { History, type HistoryTarget } from './history';
import type { LocalLog } from './local-log';
import { MOVE_LABEL, MOVE_SOURCE, type Align, type Pending, type Stamp } from './types';

/** What each kind of authored commit says it came from. */
export const SOURCES = {
  edit: 'sim.edit',
  undo: 'sim.undo',
  redo: 'sim.redo',
  revert: 'sim.revert',
  move: MOVE_SOURCE,
  name: 'sim.name',
  import: 'sim.import',
  reset: 'sim.reset'
} as const;

/** The most pending commits a tab holds. */
export const PENDING_MAX = 1_000;
/** The most bytes of pending drafts a tab holds. */
export const PENDING_BYTES_MAX = 8 * 1024 * 1024;

export type Refusal = 'unchanged' | 'invalid' | 'too-large' | 'queue-full';

/** At most LABEL_MAX UTF-16 units, never ending on half of a surrogate pair. */
export function clampLabel(label: string): string {
  if (label.length <= LABEL_MAX) return label;
  const high = label.charCodeAt(LABEL_MAX - 1);
  const cut = high >= 0xd800 && high <= 0xdbff ? LABEL_MAX - 1 : LABEL_MAX;
  return label.slice(0, cut);
}

export interface Meta {
  id: string;
  /** Clamped here. */
  label: string;
  source: string;
  stamp: Stamp;
  /** Tests only; default LIMITS. */
  limits?: Limits;
  /** Tests only; default PENDING_MAX and PENDING_BYTES_MAX. */
  caps?: { count: number; bytes: number };
}

export type Authored = { ok: true; pending: Pending } | { ok: false; why: Refusal };

const refuse = (why: Refusal): Authored => ({ ok: false, why });

/** The draft's checks in the order the refusals are answered, then the push (I7). */
function submit(
  log: LocalLog,
  draft: CommitDraft,
  targetId: string | null,
  limits: Limits,
  caps: { count: number; bytes: number }
): Authored {
  try {
    parseCommitDraft(draft);
  } catch (e) {
    if (e instanceof LogFormatError) return refuse('invalid');
    throw e;
  }
  if (!fitsCommit(draft, limits)) return refuse('too-large');
  if (
    log.pending.length >= caps.count ||
    log.pendingBytes + utf8Bytes(JSON.stringify(draft)) > caps.bytes
  )
    return refuse('queue-full');
  const pending: Pending = { draft, targetId };
  try {
    log.push(pending);
  } catch (e) {
    if (e instanceof LogError) return refuse('invalid');
    throw e;
  }
  return { ok: true, pending };
}

/** diff, or null when either side has an empty brush or two items with one key. */
function diffOrNull(a: RulesetContent, b: RulesetContent): Change[] | null {
  try {
    return diff(a, b);
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
}

/** The draft every author function builds, before its checks. */
function draftOf(
  log: LocalLog,
  kind: CommitDraft['kind'],
  restores: Restores | null,
  meta: Pick<Meta, 'id' | 'label' | 'source' | 'stamp'>,
  changes: Change[]
): CommitDraft {
  return {
    id: meta.id,
    parent: log.position,
    kind,
    label: clampLabel(meta.label),
    restores,
    datasetVersion: meta.stamp.datasetVersion,
    shapes: SHAPES_REVISION,
    build: meta.stamp.build,
    source: meta.source,
    changes
  };
}

const limitsOf = (m: Meta) => m.limits ?? LIMITS;
const capsOf = (m: Meta) => m.caps ?? { count: PENDING_MAX, bytes: PENDING_BYTES_MAX };

/** An edit (or a system commit: an import, an alignment) taking the fold to `next`. Pushes it. */
export function authorEdit(
  log: LocalLog,
  next: RulesetContent,
  meta: Meta,
  kind: 'edit' | 'system' = 'edit'
): Authored {
  let changes: Change[] | null;
  try {
    changes = diffOrNull(log.ruleset(), { name: next.name, policy: toLogForm(next.policy) });
  } catch (e) {
    if (e instanceof RangeError) return refuse('invalid');
    throw e;
  }
  if (changes === null) return refuse('invalid');
  if (changes.length === 0) return refuse('unchanged');
  return submit(log, draftOf(log, kind, null, meta, changes), null, limitsOf(meta), capsOf(meta));
}

/**
 * A restore of `position` (undo, redo or jump), aligned to the stamp's dataset when the ruleset
 * there is on another. Pushes it.
 */
export function authorRestore(
  log: LocalLog,
  position: number,
  as: Restores['as'],
  meta: Meta,
  align: Align
): Authored {
  if (!Number.isInteger(position) || position < 0 || position > log.position)
    return refuse('invalid');
  const target = log.rulesetAt(position);
  const to = meta.stamp.datasetVersion;
  let content: RulesetContent = target;
  if (target.datasetVersion !== null && target.datasetVersion !== to) {
    const aligned = align(target, to);
    if (aligned === null) return refuse('invalid');
    content = aligned;
  }
  const changes = diffOrNull(log.ruleset(), content);
  if (changes === null) return refuse('invalid');
  if (changes.length === 0) return refuse('unchanged');
  const draft = draftOf(log, 'restore', { position, as }, meta, changes);
  return submit(log, draft, log.idAt(position), limitsOf(meta), capsOf(meta));
}

/**
 * The move, or on the fold's own dataset the alignment, commit to the stamp's dataset; 'unchanged'
 * when `align` changes nothing or the log has no commits.
 */
export function authorMove(
  log: LocalLog,
  align: Align,
  meta: Omit<Meta, 'label' | 'source'>
): Authored {
  const cur = log.ruleset();
  const to = meta.stamp.datasetVersion;
  if (cur.datasetVersion === null) return refuse('unchanged');
  const aligned = align(cur, to);
  if (aligned === null) return refuse('invalid');
  const changes = diffOrNull(cur, aligned);
  if (changes === null) return refuse('invalid');
  if (changes.length === 0) return refuse('unchanged');
  const full = { ...meta, label: MOVE_LABEL, source: MOVE_SOURCE };
  const draft = draftOf(log, 'system', null, full, changes);
  return submit(log, draft, null, limitsOf(full), capsOf(full));
}

/** The undo or redo target, skipping targets equal to the local ruleset (decision 10). */
export function nextTarget(log: LocalLog, which: 'undo' | 'redo'): HistoryTarget | null {
  const history: History = log.history().clone();
  const here = rulesetText(log.ruleset());
  for (;;) {
    const target = history[which];
    if (target === null) return null;
    if (rulesetText(log.rulesetAt(target.position)) !== here) return target;
    history.push({
      seq: history.position + 1,
      kind: 'restore',
      restores: { position: target.position, as: which },
      label: target.label
    });
  }
}
