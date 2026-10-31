import type { Plan } from '$lib/plan';
import { PLAN_CODEC, type DocCodec } from './doc-codec';
import { preserveCorrupt, readRecord, writeRecord, type ReadResult } from './storage';

function safeRead<D>(storage: Storage, codec: DocCodec<D>): ReadResult<D> | null {
  try {
    return readRecord(storage, codec);
  } catch {
    return null;
  }
}

/** The local autosaved document: null when missing, unreadable or storage is unavailable. */
export function localDoc<D>(storage: Storage | null, codec: DocCodec<D>): D | null {
  if (!storage) return null;
  const r = safeRead(storage, codec);
  return r?.kind === 'ok' ? r.plan : null;
}

/** Op count of the local autosaved plan: ok → ops.length, else (missing/corrupt/unavailable) 0. */
export function localOpCount(storage: Storage | null): number {
  const p = localDoc(storage, PLAN_CODEC);
  return p ? p.ops.length : 0;
}

/**
 * Preserves a corrupt/future local record, then writes rebasePlan(plan, current) (title kept,
 * no lastPublished). Returns the serialized plan and whether the write succeeded. A corrupt
 * record that cannot be preserved is never overwritten (stored: false). Throws TypeError only
 * if `current` is invalid.
 */
export function remixToLocal<D = Plan>(
  doc: D,
  current: string,
  storage: Storage | null,
  now: Date = new Date(),
  codec: DocCodec<D> = PLAN_CODEC as unknown as DocCodec<D>
): { planText: string; stored: boolean } {
  const planText = codec.serialize(codec.rebase(doc, current));
  if (!storage) return { planText, stored: false };
  const r = safeRead(storage, codec);
  if (r === null) return { planText, stored: false };
  if ((r.kind === 'corrupt' || r.kind === 'future') && !preserveCorrupt(storage, r.raw, now, codec))
    return { planText, stored: false };
  const stored = writeRecord(storage, { v: 1, savedAt: now.toISOString(), plan: planText }, codec);
  return { planText, stored };
}
