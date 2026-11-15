import { LogFormatError, parseCommitDraft, type CommitDraft } from '$lib/sim-log';
import type { RefusedWhy } from '$lib/sim-stream/protocol';
import { LIMITS, type Limits } from './limits';

export interface AppendGate {
  gone: boolean;
  write: boolean;
  identity: string | null;
  /** Spends one token of the sim's shared budget; false when none is left. */
  takeToken: () => boolean;
  tip: number;
  /** Bytes stored so far. */
  bytes: number;
  hasId(id: string): boolean;
}

export type AppendDecision =
  | { kind: 'refused'; id: string | null; why: RefusedWhy }
  | { kind: 'duplicate'; id: string }
  | { kind: 'accept'; draft: CommitDraft };

/**
 * The order in which an append is checked: gone, not-writer, rate, frame size, parse, duplicate
 * id, sim length and size (`full`), parent. The token is taken at the rate step only, so a reader or a
 * signed-out socket never spends the budget. The fold check follows in the log host.
 */
export function decideAppend(
  gate: AppendGate,
  commit: unknown,
  id: string | null,
  frameBytes: number,
  limits: Limits = LIMITS
): AppendDecision {
  const refuse = (why: RefusedWhy): AppendDecision => ({ kind: 'refused', id, why });
  if (gate.gone) return refuse('gone');
  if (!gate.write || gate.identity === null) return refuse('not-writer');
  if (!gate.takeToken()) return refuse('limit');
  if (frameBytes > limits.frameBytes) return refuse('limit');
  let draft: CommitDraft;
  try {
    draft = parseCommitDraft(commit);
  } catch (e) {
    if (e instanceof LogFormatError) return refuse('invalid');
    throw e;
  }
  if (gate.hasId(draft.id)) return { kind: 'duplicate', id: draft.id };
  if (gate.tip >= limits.simCommits || gate.bytes + frameBytes > limits.simBytes) {
    return refuse('full');
  }
  if (draft.parent !== gate.tip) return refuse('behind');
  return { kind: 'accept', draft };
}
