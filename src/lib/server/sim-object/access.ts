import { abilityDominates, ROLE_BUNDLE } from '$lib/server/authz/ability';
import type { SimMemberRole } from '$lib/server/db/schema/simControlPlane';

import { IDENTITY_MAX } from './open-params';

/**
 * A socket's state, kept as its hibernation attachment (16 KiB max; at most about 200 bytes).
 * `sid` is the socket's id, minted by the object when it opens the socket: it keys the object's
 * one-resume-per-socket rule and nothing else, and is never sent or logged. A socket opened by a
 * build from before ids has none.
 */
export interface SocketAttachment {
  identity: string | null;
  write: boolean;
  resumed: boolean;
  sid?: string;
}

const SOCKET_ID_RE = /^[0-9a-f]{24}$/;

/** A new socket id: 96 random bits as 24 hex characters. */
export function newSocketId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Null unless `v` is exactly an attachment (with an id, or one from before ids); a writer always
 * has an identity.
 */
export function parseAttachment(v: unknown): SocketAttachment | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  const hasSid = keys.includes('sid');
  if (
    keys.length !== (hasSid ? 4 : 3) ||
    !['identity', 'write', 'resumed'].every((k) => keys.includes(k))
  ) {
    return null;
  }
  const { identity, write, resumed, sid } = o;
  if (typeof write !== 'boolean' || typeof resumed !== 'boolean') return null;
  if (hasSid && (typeof sid !== 'string' || !SOCKET_ID_RE.test(sid))) return null;
  if (identity !== null) {
    if (typeof identity !== 'string' || identity.length < 1 || identity.length > IDENTITY_MAX) {
      return null;
    }
  } else if (write) {
    return null;
  }
  return hasSid ? { identity, write, resumed, sid: sid as string } : { identity, write, resumed };
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
