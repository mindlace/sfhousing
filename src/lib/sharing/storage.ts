import { parsePlan, type Plan } from '$lib/plan';

export const PLAN_KEY = 'sfhousing:plan:v1';
export const corruptKey = (iso: string) => `sfhousing:plan:corrupt:${iso}`;

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

export type ReadResult =
  | { kind: 'missing' }
  | { kind: 'ok'; record: LocalPlanRecord; plan: Plan }
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
export function readRecord(storage: Storage): ReadResult {
  const raw = storage.getItem(PLAN_KEY);
  if (raw === null) return { kind: 'missing' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'corrupt', raw };
  }
  if (!isRecord(parsed)) return { kind: 'corrupt', raw };
  const p = parsePlan(parsed.plan);
  if (!p.ok) return { kind: p.errors[0]?.code === 'future-schema' ? 'future' : 'corrupt', raw };
  const record: LocalPlanRecord = { v: 1, savedAt: parsed.savedAt, plan: parsed.plan };
  if (parsed.lastPublished)
    record.lastPublished = { id: parsed.lastPublished.id, hash: parsed.lastPublished.hash };
  return { kind: 'ok', record, plan: p.value };
}

/** False on any throw (QuotaExceededError, SecurityError). */
export function writeRecord(storage: Storage, record: LocalPlanRecord): boolean {
  try {
    storage.setItem(PLAN_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/** Copies an unreadable record to `sfhousing:plan:corrupt:<ISO>`. False on any throw. */
export function preserveCorrupt(storage: Storage, raw: string, now: Date): boolean {
  try {
    storage.setItem(corruptKey(now.toISOString()), raw);
    return true;
  } catch {
    return false;
  }
}
