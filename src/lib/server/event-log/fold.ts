/**
 * Pure, host-agnostic folds over an append-only event log. The single owner of the
 * last-write-wins (+ revoke-on-tie) reduce contract. Callers run their own ordered query
 * (D1 async or DO sync) and hand the rows here; the kernel never touches I/O.
 *
 * INVARIANT: every fold assumes events arrive sorted by (createdAt ASC, createdAtCounter ASC)
 * — the order every caller's `ORDER BY created_at, created_at_counter` produces.
 */

/**
 * Walk a pre-ordered event log into a keyed accumulator. `step` mutates `acc` per event
 * (install / mutate-in-place / delete); its return value is ignored. Returns `acc`.
 */
export function foldEventLog<E, S>(
  events: Iterable<E>,
  step: (acc: Map<string, S>, event: E) => void,
  acc: Map<string, S> = new Map()
): Map<string, S> {
  for (const event of events) step(acc, event);
  return acc;
}

/**
 * Last-write-wins: the last event (in pre-sorted log order) for each `key(e)` wins.
 * Returns Map<key, event>. Callers project/filter the surviving events themselves.
 */
export function foldLatest<E>(events: Iterable<E>, key: (e: E) => string): Map<string, E> {
  return foldEventLog<E, E>(events, (acc, event) => acc.set(key(event), event));
}

/**
 * Last-write-wins with revoke-on-tie: among events sharing the SAME `stamp(e)` for a key, one
 * whose `isRevoke(e)` is true beats a non-revoke (fail-closed / least-privilege). Unlike
 * `foldLatest` it does NOT trust raw arrival order for ties — it keys off `stamp`, matching the
 * capability ledger's documented semantics. Returns Map<key, event>.
 */
export function foldRevokeWins<E>(
  events: Iterable<E>,
  opts: { key: (e: E) => string; stamp: (e: E) => number; isRevoke: (e: E) => boolean }
): Map<string, E> {
  const tracked = new Map<string, { event: E; at: number }>();
  for (const event of events) {
    const k = opts.key(event);
    const at = opts.stamp(event);
    const cur = tracked.get(k);
    if (!cur || at > cur.at || (at === cur.at && opts.isRevoke(event)))
      tracked.set(k, { event, at });
  }
  const out = new Map<string, E>();
  for (const [k, v] of tracked) out.set(k, v.event);
  return out;
}
