/**
 * The one answer the page shows next to the title: saved, saving, saved on this device only, or
 * not saved, with a reason code. Pure: types only are imported, so nothing here has an effect.
 */
import type { LocalStatus } from '$lib/sim-store/log-store.svelte';
import type { Stopped } from '$lib/sim-store/types';
import type { SocketView } from './sim-socket';

export type RegState =
  | 'idle'
  | 'none'
  | 'waiting'
  | 'registering'
  | 'retrying'
  | 'sign-in'
  | 'taken'
  | 'quota'
  | 'failed'
  | 'done';

export interface SaveInput {
  live: boolean;
  local: LocalStatus;
  pendingCount: number;
  /** Commits held out of force: on the device, never sent (LogStore.heldCount). */
  heldCount: number;
  stopped: Stopped | null;
  registration: RegState;
  socket: SocketView;
}

export type SaveKind = 'saved' | 'saving' | 'device' | 'unsaved';

export type SaveWhy =
  | 'dev'
  | 'offline'
  | 'unreachable'
  | 'sign-in'
  | 'taken'
  | 'quota'
  | 'register-failed'
  | 'no-write'
  | 'full'
  | 'newer'
  | 'gone'
  | 'diverged'
  | 'protocol'
  | 'broken'
  | 'stale'
  | 'future'
  | 'unknown-dataset';

export interface SaveState {
  kind: SaveKind;
  /** Why it is not saved or saving: the details on tap. Null for saved and saving. */
  why: SaveWhy | null;
}

export function saveState(i: SaveInput): SaveState {
  // A stop counts against "saved" only when something is pending or held.
  if (i.pendingCount === 0 && i.heldCount === 0) return { kind: 'saved', why: null };
  const why = blocked(i);
  if (why === null || i.local === 'writing') return { kind: 'saving', why: null };
  return { kind: i.local === 'failed' ? 'unsaved' : 'device', why };
}

/** What keeps the unsent commits from the server, first match in this order; null: nothing does. */
function blocked(i: SaveInput): SaveWhy | null {
  const s = i.socket;
  if (s.halt !== null) return s.halt;
  if (s.hold === 'full' || s.hold === 'newer') return s.hold;
  if (i.stopped === 'stale' || i.stopped === 'future') return i.stopped;
  if (i.stopped === 'unknown-dataset' && s.phase === 'live') return 'unknown-dataset';
  if (!i.live) return 'dev';
  switch (i.registration) {
    case 'sign-in':
    case 'taken':
    case 'quota':
      return i.registration;
    case 'failed':
      return 'register-failed';
    case 'retrying':
      return 'unreachable';
    case 'registering':
    case 'waiting':
      return null;
  }
  if (s.hold === 'not-writer' || s.write === false) return 'no-write';
  if (s.phase === 'offline') return 'offline';
  if (s.phase === 'waiting' || s.phase === 'off') return 'unreachable';
  return null;
}
