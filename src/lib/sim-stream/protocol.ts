// The websocket frames of a sim, imported by the server and by clients. Type-only imports: the
// browser and e2e can load this file without the log core.
import type { Commit, CommitDraft } from '$lib/sim-log';

export const PROTOCOL = 1;
export const PING = 'ping';
export const PONG = 'pong';
export const CLOSE_BINARY = 1003;
export const CLOSE_MALFORMED = 1008;
export const CLOSE_INTERNAL = 1011;
export const CLOSE_GONE = 4410;

/**
 * Why an append or a resume was refused. `limit` is the rate or one commit's size (back off);
 * `full` is a sim at its commit-count or byte cap (permanent: it takes no more commits).
 */
export type RefusedWhy = 'behind' | 'invalid' | 'newer' | 'not-writer' | 'limit' | 'full' | 'gone';

export type ServerFrame =
  | { type: 'hello'; build: string; protocol: number; dataset?: string }
  | { type: 'access'; write: boolean }
  | { type: 'commits'; commits: Commit[]; more?: boolean }
  | { type: 'refused'; id: string | null; why: RefusedWhy };

export type ClientFrame =
  { type: 'resume'; after: number } | { type: 'append'; commit: CommitDraft };

/** A client frame as the server reads it: the commit is not parsed yet. */
export type ParsedClientFrame =
  { type: 'resume'; after: number } | { type: 'append'; commit: unknown; id: string | null };

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function sameKeys(o: Record<string, unknown>, keys: string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => k in o);
}

/** Null for anything that is not exactly one of the two client frames. */
export function parseClientFrame(text: string): ParsedClientFrame | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlain(v)) return null;
  if (v.type === 'resume' && sameKeys(v, ['type', 'after'])) {
    const after = v.after;
    if (typeof after === 'number' && Number.isSafeInteger(after) && after >= 0) {
      return { type: 'resume', after };
    }
    return null;
  }
  if (v.type === 'append' && sameKeys(v, ['type', 'commit'])) {
    const c = v.commit;
    const id =
      isPlain(c) && typeof c.id === 'string' && c.id.length >= 1 && c.id.length <= 64 ? c.id : null;
    return { type: 'append', commit: c, id };
  }
  return null;
}

export function encodeFrame(
  frame: Exclude<ServerFrame, { type: 'commits' }> | ClientFrame
): string {
  return JSON.stringify(frame);
}

/**
 * A commits frame from stored bodies, spliced as they are stored. `more` only on the last frame of
 * a resume answer: false caught up, true send resume again. Live frames carry none.
 */
export function commitsFrame(bodies: readonly string[], more?: boolean): string {
  const tail = more === undefined ? '' : `,"more":${more ? 'true' : 'false'}`;
  return '{"type":"commits","commits":[' + bodies.join(',') + ']' + tail + '}';
}
