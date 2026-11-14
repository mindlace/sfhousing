/** A typed, addressable resource. `app` is the global root (id '*'). */
export type ResourceType = 'app' | 'sim';
export type ResourceRef = { type: ResourceType; id: string };

/** The global root resource: an `app:*` capability covers every resource. */
export const APP_RESOURCE: ResourceRef = { type: 'app', id: '*' };

function sameRef(a: ResourceRef, b: ResourceRef): boolean {
  return a.type === b.type && a.id === b.id;
}

/**
 * Does a capability held over `held` cover an action on `target`?
 * True when `held` is the global app root (`APP_RESOURCE`, the only meaningful `app`
 * resource; any other `app` id is not special), equals `target`, or equals one of
 * `target`'s ancestors (its containment chain, supplied by the caller). Containment is
 * data-driven by `ancestors`, so this stays pure: any DB-backed ancestor lookup lives in
 * the wiring layer. A capability granted DIRECTLY on `target` covers it regardless of
 * ancestors.
 */
export function covers(
  held: ResourceRef,
  target: ResourceRef,
  ancestors: ResourceRef[] = []
): boolean {
  if (sameRef(held, APP_RESOURCE)) return true;
  if (sameRef(held, target)) return true;
  return ancestors.some((a) => sameRef(held, a));
}
