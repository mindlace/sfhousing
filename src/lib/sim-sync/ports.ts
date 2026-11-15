import type { Commit, CommitDraft } from '$lib/sim-log';
import type { LocalStatus, Registration, StoreReceived } from '$lib/sim-store/log-store.svelte';
import type { Stopped } from '$lib/sim-store/types';

export interface Clock {
  now(): number;
  /** Runs fn once after ms; returns a cancel that is safe to call twice. */
  after(ms: number, fn: () => void): () => void;
}

/** Date.now and the platform's timers. */
export const realClock: Clock = {
  now: () => Date.now(),
  after(ms, fn) {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  }
};

/** An event as SimSocket reads it: `data` on message, `code` on close. */
export interface SocketEventLike {
  data?: unknown;
  code?: number;
}

/** What SimSocket uses of a WebSocket. */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    fn: (e: SocketEventLike) => void
  ): void;
}

/** `WebSocket` itself must be assignable to this (checked in browserPorts). */
export type SocketCtor = new (url: string) => SocketLike;

/** The parts of navigator.locks used (LockManager is assignable to it). */
export interface LocksLike {
  request(
    name: string,
    options: LockOptions,
    callback: (lock: Lock | null) => unknown
  ): Promise<unknown>;
  query(): Promise<LockManagerSnapshot>;
}

/** The parts of a BroadcastChannel used. */
export interface ChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
  removeEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
  close(): void;
}

export type NetEvent = 'online' | 'offline' | 'visible' | 'hidden';

export interface NetSignals {
  online(): boolean;
  visible(): boolean;
  /** Calls fn on each change; returns the unsubscribe. */
  watch(fn: (e: NetEvent) => void): () => void;
}

/** What SimSocket and SimSync use of the log store (LogStore is assignable to it). */
export interface SyncStore {
  readonly ready: boolean;
  readonly simId: string | null;
  readonly tipSeq: number;
  readonly pendingCount: number;
  readonly heldCount: number;
  readonly stopped: Stopped | null;
  readonly local: LocalStatus;
  readonly registration: Registration;
  head(): CommitDraft | null;
  receive(simId: string, commits: readonly Commit[]): StoreReceived;
  setServerDataset(s: string): void;
  dropPending(id: string): void;
  markRegistered(simId: string): Promise<void>;
  subscribe(fn: () => void): () => void;
  open(simId: string | null, opts?: { claim?: readonly string[] }): Promise<void>;
  claim(owners: readonly string[]): Promise<number>;
}

export interface BrowserPorts {
  origin: string;
  fetch: typeof fetch;
  WebSocket: SocketCtor;
  clock: Clock;
  random: () => number;
  locks: LocksLike | null;
  channel: ChannelLike | null;
  net: NetSignals;
}

/** make(), or null when it returns null or throws (a port the browser withholds is null). */
function attempt<T>(make: () => T | null): T | null {
  try {
    return make();
  } catch {
    return null;
  }
}

/**
 * The live ports of this window: location.origin, fetch, WebSocket, realClock, Math.random,
 * navigator.locks or null, a BroadcastChannel('sfh-sim') or null, and online/offline and
 * visibilitychange as NetSignals. Call only in a browser. A port that cannot be reached or
 * constructed (Web Locks, BroadcastChannel) is null; nothing runs at import time.
 */
export function browserPorts(): BrowserPorts {
  const ctor: SocketCtor = WebSocket;
  const locks = attempt<LocksLike>(() => ('locks' in navigator ? navigator.locks : null));
  const channel = attempt<ChannelLike>(() =>
    typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('sfh-sim')
  );
  return {
    origin: location.origin,
    fetch: (input, init) => fetch(input, init),
    WebSocket: ctor,
    clock: realClock,
    random: () => Math.random(),
    locks,
    channel,
    net: {
      online: () => navigator.onLine,
      visible: () => document.visibilityState === 'visible',
      watch(fn) {
        const on = () => fn('online');
        const off = () => fn('offline');
        const vis = () => fn(document.visibilityState === 'visible' ? 'visible' : 'hidden');
        window.addEventListener('online', on);
        window.addEventListener('offline', off);
        document.addEventListener('visibilitychange', vis);
        return () => {
          window.removeEventListener('online', on);
          window.removeEventListener('offline', off);
          document.removeEventListener('visibilitychange', vis);
        };
      }
    }
  };
}

/** The `name` of a thrown value, for logs ('unknown' when it has none). */
export function errorName(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'name' in e && typeof e.name === 'string') {
    return e.name;
  }
  return 'unknown';
}
