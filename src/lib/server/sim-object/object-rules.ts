// The decisions the SimObject class makes about a socket, as pure functions: the class
// (sim-object.ts) only calls them, so it holds no rule a Node spec does not cover.
import {
  CLOSE_BINARY,
  CLOSE_MALFORMED,
  parseClientFrame,
  type ParsedClientFrame
} from '$lib/sim-stream/protocol';
import { accessChanges, parseAttachment, type SocketAttachment } from './access';
import { LIMITS, overFrameLimit, utf8Bytes, type Limits } from './limits';
import type { OpenParams } from './open-params';

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

/** Each identity of a socket with a valid attachment, once. */
export function distinctIdentities(attachments: readonly unknown[]): string[] {
  const out = new Set<string>();
  for (const a of attachments) {
    const identity = parseAttachment(a)?.identity;
    if (identity) out.add(identity);
  }
  return [...out];
}
