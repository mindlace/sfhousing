// The decisions the SimObject class makes about a socket, as pure functions: the class
// (sim-object.ts) only calls them, so it holds no rule a Node spec does not cover.
import { DrizzleQueryError } from 'drizzle-orm';
import {
  CLOSE_BINARY,
  CLOSE_MALFORMED,
  PROTOCOL,
  encodeFrame,
  parseClientFrame,
  type ParsedClientFrame,
  type RefusedWhy
} from '$lib/sim-stream/protocol';
import { accessChanges, parseAttachment, type SocketAttachment } from './access';
import { LIMITS, overFrameLimit, utf8Bytes, type Limits } from './limits';
import type { AppendOutcome } from './log-host';
import type { OpenParams } from './open-params';

/** What the appendAs RPC answers: no commit body or id crosses back to the Worker. */
export type ServerAppendResult =
  { kind: 'accepted'; seq: number } | { kind: 'duplicate' } | { kind: 'refused'; why: RefusedWhy };

export function serverAppendResult(out: AppendOutcome): ServerAppendResult {
  if (out.kind === 'accepted') return { kind: 'accepted', seq: out.commit.seq };
  if (out.kind === 'duplicate') return { kind: 'duplicate' };
  return { kind: 'refused', why: out.why };
}

/** The message appendAs throws on any failure but a missing host. Fixed: it names no identity. */
export const APPEND_FAILED = 'append failed';

/** The first frame on a socket: the Worker's build, PROTOCOL and its dataset version (R55). */
export function helloFrame(p: OpenParams): string {
  return encodeFrame({
    type: 'hello',
    build: p.build,
    protocol: PROTOCOL,
    dataset: p.datasetVersion
  });
}

export interface OpenInput {
  /** The request's Upgrade header. */
  upgrade: string | null;
  /** The parsed OPEN_HEADER, null when absent or malformed. */
  params: OpenParams | null;
  /** ctx.id.name: the sim id, absent when the object was not reached by name. */
  simId: string | undefined;
  /** Whether the log host exists (the object's migration succeeded). */
  host: boolean;
  gone: boolean;
}

/** The status refusing a socket open, or null to open it. */
export function openStatus(o: OpenInput): 426 | 400 | 503 | 410 | null {
  if (o.upgrade?.toLowerCase() !== 'websocket') return 426;
  if (!o.params || !o.simId) return 400;
  if (!o.host) return 503;
  if (o.gone) return 410;
  return null;
}

export type MessageRead =
  | { kind: 'close'; code: number; reason: string }
  | { kind: 'oversized' }
  | { kind: 'frame'; frame: ParsedClientFrame; attachment: SocketAttachment; bytes: number };

/**
 * What an incoming message is: a binary message closes 1003; a socket without a valid
 * attachment or a malformed frame closes 1008; a text longer than the frame limit is refused
 * unparsed; otherwise the frame, the socket's attachment and the message's UTF-8 size.
 */
export function readMessage(
  message: string | ArrayBuffer,
  attachment: unknown,
  limits: Limits = LIMITS
): MessageRead {
  if (typeof message !== 'string') return { kind: 'close', code: CLOSE_BINARY, reason: 'binary' };
  const att = parseAttachment(attachment);
  if (!att) return { kind: 'close', code: CLOSE_MALFORMED, reason: 'malformed' };
  if (overFrameLimit(message, limits)) return { kind: 'oversized' };
  const frame = parseClientFrame(message);
  if (!frame) return { kind: 'close', code: CLOSE_MALFORMED, reason: 'malformed' };
  return { kind: 'frame', frame, attachment: att, bytes: utf8Bytes(message) };
}

/** Codes that never travel in a close frame and so cannot be sent back. */
const RESERVED = new Set([1005, 1006, 1015]);

/** The code the object closes with in reply to a peer's close. */
export function closeReply(code: number): number {
  return RESERVED.has(code) ? 1000 : code;
}

/**
 * The sockets whose right to write differs from `writers`, each with its new attachment. Only
 * sockets whose identity is in `writers` take part: one opened while the roles were being read
 * keeps the right the Worker just gave it, and an invalid attachment is left alone. Call this only
 * after a role read that succeeded for every identity (accessChanges fails closed).
 */
export function roleChanges(
  attachments: readonly unknown[],
  writers: ReadonlyMap<string, boolean>
): { index: number; attachment: SocketAttachment }[] {
  const parsed = attachments.map(parseAttachment);
  const known = parsed.map((a) =>
    a && a.identity !== null && writers.has(a.identity) ? a : { identity: null, write: false }
  );
  return accessChanges(known, writers).map((index) => {
    const a = parsed[index] as SocketAttachment;
    return { index, attachment: { ...a, write: writers.get(a.identity as string) ?? false } };
  });
}

/** The longest text logged for an error. */
export const LOG_MAX = 300;
/** Logged in place of a thrown value that is not an Error. */
export const NON_ERROR = '(non-error thrown)';
/** Logged in place of a failed query's own message, which holds its SQL and bound parameters. */
export const QUERY_FAILED = '(query failed)';

/**
 * The text that may be logged for a thrown value: the innermost Error cause's message, never a
 * DrizzleQueryError's own message (it carries the query's bound parameters, identities among
 * them), cut to LOG_MAX characters; NON_ERROR for anything that is not an Error.
 */
export function loggable(e: unknown): string {
  if (!(e instanceof Error)) return NON_ERROR;
  let inner: Error = e;
  const seen = new Set<Error>([inner]);
  while (inner.cause instanceof Error && !seen.has(inner.cause)) {
    inner = inner.cause;
    seen.add(inner);
  }
  const text =
    inner instanceof DrizzleQueryError || inner.name === 'DrizzleQueryError'
      ? QUERY_FAILED
      : inner.message;
  return text.length > LOG_MAX ? text.slice(0, LOG_MAX - 1) + '…' : text;
}

/**
 * The socket's attachment marked resumed, built from its current attachment so a `write` changed
 * by a concurrent rereadRoles is kept; null when the attachment is invalid (I7).
 */
export function withResumed(attachment: unknown): SocketAttachment | null {
  const a = parseAttachment(attachment);
  return a ? { ...a, resumed: true } : null;
}

/** Whether a live commit goes to this socket: only once it has resumed (I7). */
export function receivesLive(attachment: unknown): boolean {
  return parseAttachment(attachment)?.resumed === true;
}

/** The message rereadRoles throws when its role read fails. Fixed: it names no identity. */
export const ROLE_READ_FAILED = 'role read failed';

/**
 * rereadRoles' decision. Reads the role of each distinct identity on the open sockets (the list
 * `sockets()` gives before the read), then names the sockets whose right changed in a second list
 * taken after the read (indexes refer to it). No socket with an identity: nothing read, [].
 * A failed read logs once (label and loggable text) and throws Error(ROLE_READ_FAILED): nobody
 * is revoked, and the caller decides whether to retry.
 */
export async function rereadChanges(
  sockets: () => readonly unknown[],
  canWriteOf: (identity: string) => Promise<boolean>,
  label: string
): Promise<{ index: number; attachment: SocketAttachment }[]> {
  const identities = distinctIdentities(sockets());
  if (identities.length === 0) return [];
  let writers: Map<string, boolean>;
  try {
    const read = await Promise.all(
      identities.map(async (id) => [id, await canWriteOf(id)] as const)
    );
    writers = new Map(read);
  } catch (e) {
    console.error('[sim-object] role read failed', label, loggable(e));
    // No cause: a failed query's error carries its bound parameters (identities) and would
    // travel to the RPC caller.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(ROLE_READ_FAILED);
  }
  return roleChanges(sockets(), writers);
}

/** Each identity of a socket with a valid attachment, once. */
export function distinctIdentities(attachments: readonly unknown[]): string[] {
  const out = new Set<string>();
  for (const a of attachments) {
    const identity = parseAttachment(a)?.identity;
    if (identity) out.add(identity);
  }
  return [...out];
}
