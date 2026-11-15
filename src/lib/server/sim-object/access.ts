import { abilityDominates, ROLE_BUNDLE } from '$lib/server/authz/ability';
import type { SimMemberRole } from '$lib/server/db/schema/simControlPlane';

import { IDENTITY_MAX } from './open-params';

/** A socket's state, kept as its hibernation attachment (16 KiB max; this is well under). */
export interface SocketAttachment {
  identity: string | null;
  write: boolean;
  resumed: boolean;
}

/** Null unless `v` is exactly an attachment; a writer always has an identity. */
export function parseAttachment(v: unknown): SocketAttachment | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== 3 || !['identity', 'write', 'resumed'].every((k) => keys.includes(k))) {
    return null;
  }
  const { identity, write, resumed } = o;
  if (typeof write !== 'boolean' || typeof resumed !== 'boolean') return null;
  if (identity !== null) {
    if (typeof identity !== 'string' || identity.length < 1 || identity.length > IDENTITY_MAX) {
      return null;
    }
  } else if (write) {
    return null;
  }
  return { identity, write, resumed };
}

/** R47: a role whose bundle dominates sim.write. */
export function canWrite(role: SimMemberRole | null): boolean {
  if (typeof role !== 'string' || !Object.hasOwn(ROLE_BUNDLE, role)) return false;
  return abilityDominates(ROLE_BUNDLE[role], 'sim.write');
}

/**
 * Indexes of the sockets whose right to write differs from `writers` (identity to canWrite).
 * A missing identity loses write; the caller must not call this when its role read failed.
 */
export function accessChanges(
  sockets: readonly Pick<SocketAttachment, 'identity' | 'write'>[],
  writers: ReadonlyMap<string, boolean>
): number[] {
  const out: number[] = [];
  sockets.forEach((s, i) => {
    if (s.identity === null) return;
    if ((writers.get(s.identity) ?? false) !== s.write) out.push(i);
  });
  return out;
}
