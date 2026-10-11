import { rebasePlan, serializePlan, type Plan } from '$lib/plan';
import { preserveCorrupt, readRecord, writeRecord, type ReadResult } from './storage';

function safeRead(storage: Storage): ReadResult | null {
  try {
    return readRecord(storage);
  } catch {
    return null;
  }
}

/** Op count of the local autosaved plan: ok → ops.length, else (missing/corrupt/unavailable) 0. */
export function localOpCount(storage: Storage | null): number {
  if (!storage) return 0;
  const r = safeRead(storage);
  return r?.kind === 'ok' ? r.plan.ops.length : 0;
}

/**
 * Preserves a corrupt/future local record, then writes rebasePlan(plan, current) (title kept,
 * no lastPublished). Returns the serialized plan and whether the write succeeded. A corrupt
 * record that cannot be preserved is never overwritten (stored: false). Throws TypeError only
 * if `current` is invalid.
 */
export function remixToLocal(
  plan: Plan,
  current: string,
  storage: Storage | null,
  now: Date = new Date()
): { planText: string; stored: boolean } {
  const planText = serializePlan(rebasePlan(plan, current));
  if (!storage) return { planText, stored: false };
  const r = safeRead(storage);
  if (r === null) return { planText, stored: false };
  if ((r.kind === 'corrupt' || r.kind === 'future') && !preserveCorrupt(storage, r.raw, now))
    return { planText, stored: false };
  const stored = writeRecord(storage, { v: 1, savedAt: now.toISOString(), plan: planText });
  return { planText, stored };
}
