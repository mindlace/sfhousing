import type { Plan } from '$lib/plan';
import { PLAN_CODEC, type DocCodec } from './doc-codec';

export const PLAN_KEY = PLAN_CODEC.storageKey;
export const corruptKey = (iso: string) => PLAN_CODEC.corruptKey(iso);

export interface LocalPlanRecord {
  v: 1;
  savedAt: string;
  plan: string;
  lastPublished?: { id: string; hash: string };
}

/** window.localStorage, or null when access throws / is undefined (SSR). */
export function getStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage ?? null;
  } catch {
    return null;
  }
}

export type ReadResult<D = Plan> =
  | { kind: 'missing' }
  | { kind: 'ok'; record: LocalPlanRecord; plan: D }
  | { kind: 'corrupt'; raw: string }
  | { kind: 'future'; raw: string };

function isRecord(v: unknown): v is LocalPlanRecord {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  if (r.v !== 1 || typeof r.savedAt !== 'string' || typeof r.plan !== 'string') return false;
  if (r.lastPublished === undefined) return true;
  const lp = r.lastPublished as Record<string, unknown> | null;
  return (
    typeof lp === 'object' &&
    lp !== null &&
    typeof lp.id === 'string' &&
    typeof lp.hash === 'string'
  );
}

/**
 * Reads the autosave record. A `getItem` throw propagates (callers treat it as storage
 * unavailable). JSON error, `v !== 1`, missing fields or a `parsePlan` failure → corrupt;
 * a plan from a newer schema → future.
 */
export function readRecord<D = Plan>(
  storage: Storage,
  codec: DocCodec<D> = PLAN_CODEC as unknown as DocCodec<D>
): ReadResult<D> {
  const raw = storage.getItem(codec.storageKey);
  if (raw === null) return { kind: 'missing' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'corrupt', raw };
  }
  if (!isRecord(parsed)) return { kind: 'corrupt', raw };
  const p = codec.load(parsed.plan);
  if (!p.ok) return { kind: p.errors[0]?.code === 'future-schema' ? 'future' : 'corrupt', raw };
  const record: LocalPlanRecord = { v: 1, savedAt: parsed.savedAt, plan: parsed.plan };
  if (parsed.lastPublished)
    record.lastPublished = { id: parsed.lastPublished.id, hash: parsed.lastPublished.hash };
  return { kind: 'ok', record, plan: p.value };
}

/** False on any throw (QuotaExceededError, SecurityError). */
export function writeRecord<D = Plan>(
  storage: Storage,
  record: LocalPlanRecord,
  codec: DocCodec<D> = PLAN_CODEC as unknown as DocCodec<D>
): boolean {
  try {
    storage.setItem(codec.storageKey, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/** Copies an unreadable record to `sfhousing:plan:corrupt:<ISO>`. False on any throw. */
export function preserveCorrupt<D = Plan>(
  storage: Storage,
  raw: string,
  now: Date,
  codec: DocCodec<D> = PLAN_CODEC as unknown as DocCodec<D>
): boolean {
  try {
    storage.setItem(codec.corruptKey(now.toISOString()), raw);
    return true;
  } catch {
    return false;
  }
}
