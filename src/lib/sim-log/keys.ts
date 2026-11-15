import { canonicalJson } from '$lib/sim-page/policy';
import { digest128 } from '$lib/sim/world/policy/intern';
import type { PolicyKind } from '$lib/timeline/policy4';
import type { Day } from '$lib/timelapse/time';

export const NAME_KEY = 'sim';
export const policyKey = (id: string): string => `p:${id}`;
export const spanKey = (policyId: string, from: Day): string => `s:${from}:${policyId}`;
export interface StrokeFields {
  span: string;
  brush: string;
  kind: 'paint' | 'erase';
  stories: number | null;
  path: [number, number][];
  radiusM: number;
}

/**
 * `k:` + digest128(canonicalJson) of the stroke's six key fields, picked by name, so that a field
 * a later version of the `stroke` shape adds never changes a key. A new shape version never changes
 * the fields a key is built from: these six for a stroke, `id` for a policy, `policy` and `from`
 * for a span.
 */
export function strokeKeyBase(f: StrokeFields): string {
  const { span, brush, kind, stories, path, radiusM } = f;
  return `k:${digest128(canonicalJson({ span, brush, kind, stories, path, radiusM }))}`;
}

/** The keys of a span's strokes in order: the n-th repeat of a base gets `~n` (n >= 2). */
export function strokeKeys(strokes: readonly StrokeFields[]): string[] {
  const seen = new Map<string, number>();
  return strokes.map((f) => {
    const base = strokeKeyBase(f);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}~${n}`;
  });
}

/** True when `key` is `base` or `base~n` with n >= 2. */
export function isStrokeKeyOf(key: string, f: StrokeFields): boolean {
  const base = strokeKeyBase(f);
  if (key === base) return true;
  if (!key.startsWith(`${base}~`)) return false;
  const n = key.slice(base.length + 1);
  return /^\d+$/.test(n) && Number(n) >= 2 && String(Number(n)) === n;
}

export const listKey = (owner: PolicyKind | string): string => `l:${owner}`;
