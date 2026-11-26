// Where a policy change first takes effect (pure): the playhead resets there.
import { canonicalJson } from '$lib/sim-page/policy';
import type { Day } from '$lib/timelapse/time';
import type { Policy, PolicyKind, SimPolicy4 } from './policy4';

const KINDS: PolicyKind[] = ['zoning', 'permitting', 'money'];

/**
 * The earliest span `from` (clamped to `asOf`) among policies that differ between the two
 * documents and are on in either (the on side's spans: both sides' when both are on); a kind
 * whose order of on policies changed counts all its on policies. Null when no policy in force
 * changed (an added policy that is off, an edit to a policy off on both sides).
 */
export function changeStart(before: SimPolicy4, after: SimPolicy4, asOf: Day): Day | null {
  let first: Day | null = null;
  const take = (p: Policy | undefined) => {
    if (p === undefined || !p.on) return;
    for (const s of p.spans) first = first === null ? s.from : Math.min(first, s.from);
  };
  for (const kind of KINDS) {
    const a = before.kinds[kind];
    const b = after.kinds[kind];
    const byId = (list: Policy[]) => new Map(list.map((p) => [p.id, p]));
    const ma = byId(a);
    const mb = byId(b);
    const onIds = (list: Policy[]) => list.filter((p) => p.on).map((p) => p.id);
    const reordered = canonicalJson(onIds(a)) !== canonicalJson(onIds(b));
    for (const id of new Set([...ma.keys(), ...mb.keys()])) {
      const p = ma.get(id);
      const q = mb.get(id);
      const differs = p === undefined || q === undefined || canonicalJson(p) !== canonicalJson(q);
      if (!differs && !reordered) continue;
      take(p);
      take(q);
    }
  }
  return first === null ? null : Math.max(asOf, first);
}

/** Where the playhead goes (P16): max(asOf, from), later than the playhead or not. */
export function resetDay(asOf: Day, from: Day): Day {
  return Math.max(asOf, from);
}
