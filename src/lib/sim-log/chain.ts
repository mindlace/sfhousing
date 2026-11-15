import { canonicalJson } from '$lib/sim-page/policy';
import { sha256Hex } from '$lib/sharing/hash';
import type { Commit } from './types';

export const GENESIS_HASH = '0'.repeat(64);

function assertJson(v: unknown, path: string): void {
  if (v === undefined) throw new TypeError(`${path}: undefined is not JSON`);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new TypeError(`${path}: ${v} is not JSON`);
  } else if (Array.isArray(v)) {
    v.forEach((x, i) => assertJson(x, `${path}[${i}]`));
  } else if (typeof v === 'object' && v !== null) {
    for (const [k, x] of Object.entries(v)) assertJson(x, `${path}.${k}`);
  } else if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') {
    throw new TypeError(`${path}: ${typeof v} is not JSON`);
  }
}

/**
 * canonicalJson of every field but `hash`; TypeError on undefined or a non-finite number
 * anywhere.
 */
export function commitText(c: Omit<Commit, 'hash'> | Commit): string {
  const rest: Record<string, unknown> = { ...c };
  delete rest.hash;
  assertJson(rest, 'commit');
  return canonicalJson(rest);
}

/** sha256Hex(prevHash + commitText(c)). */
export function chainHash(prevHash: string, c: Omit<Commit, 'hash'> | Commit): Promise<string> {
  return sha256Hex(prevHash + commitText(c));
}

/** The first seq whose hash or position is wrong, or null. `prev` is the commit before
 *  commits[0] (default: seq 0, GENESIS_HASH). */
export async function verifyChain(
  commits: readonly Commit[],
  prev: { seq: number; hash: string } = { seq: 0, hash: GENESIS_HASH }
): Promise<number | null> {
  let seq = prev.seq;
  let hash = prev.hash;
  for (const c of commits) {
    seq += 1;
    if (c.seq !== seq) return c.seq;
    const want = await chainHash(hash, c);
    if (c.hash !== want) return c.seq;
    hash = want;
  }
  return null;
}
