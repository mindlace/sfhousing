import { untrack } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { newId } from '$lib/ids/base58';
import type { AccountLine } from './save-api';
import { defaultSaveName, parseGameSave, type GameSave } from './saves';
import type { GameStore } from './store.svelte';

export type SyncState = 'local' | 'saving' | 'saved' | 'offline' | 'sign-in' | 'full';

export interface SaveSync {
  /** Reactive. */
  readonly state: SyncState;
  /** Reactive: the account as the server last answered (S1's `AccountLine`); null until it has. */
  readonly account: AccountLine | null;
  /** The saved game `id` changed. */
  changed(id: string): void;
  /** The saved game `id` was deleted in this browser. */
  removed(id: string): void;
  /** Bring the account's saved games here and send this browser's there. */
  pull(): Promise<void>;
  /** The store saved games are read from and adopted into. Called once by the root layout. */
  attach(store: GameStore): void;
}

export const SAVE_REVS_KEY = 'sfhousing:saves:revs';

/** The one reload after a pull replaced the current game; a test spies on it. */
export const syncReload = {
  reload(): void {
    location.reload();
  }
};

/** What this browser last agreed with the account. */
export interface SyncRecord {
  v: 1;
  /** Per saved game: the rev and the savedAt of the version last sent or adopted. */
  seen: Record<string, { rev: number; savedAt: string }>;
  /** Saved games deleted here whose DELETE has not yet been answered. */
  deleting: string[];
}

const DEBOUNCE_MS = 2000;

const emptyRecord = (): SyncRecord => ({ v: 1, seen: {}, deleting: [] });

function isPlain(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** The record when `text` is one, else null. */
function parseRecord(text: string): SyncRecord | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlain(json) || json.v !== 1 || !isPlain(json.seen) || !Array.isArray(json.deleting)) {
    return null;
  }
  const seen: SyncRecord['seen'] = {};
  for (const [id, e] of Object.entries(json.seen)) {
    if (!isPlain(e) || typeof e.rev !== 'number' || !Number.isInteger(e.rev)) return null;
    if (typeof e.savedAt !== 'string') return null;
    seen[id] = { rev: e.rev, savedAt: e.savedAt };
  }
  if (!json.deleting.every((d) => typeof d === 'string')) return null;
  return { v: 1, seen, deleting: [...(json.deleting as string[])] };
}

/** How a request ended: an answer (with its parsed body, null when none) or a network failure. */
type Ended = { ok: true; status: number; body: unknown } | { ok: false };

function lineOf(body: unknown): AccountLine | null {
  if (!isPlain(body) || typeof body.handle !== 'string') return null;
  if (typeof body.handleClaimed !== 'boolean') return null;
  return { handle: body.handle, handleClaimed: body.handleClaimed };
}

interface AccountList {
  line: AccountLine;
  saves: { id: string; savedAt: string; rev: number }[];
  removed: string[];
}

/** The list answer when it reads as one, else null. */
function listOf(body: unknown): AccountList | null {
  const line = lineOf(body);
  if (line === null || !isPlain(body)) return null;
  if (!Array.isArray(body.saves) || !Array.isArray(body.removed)) return null;
  const saves: AccountList['saves'] = [];
  for (const e of body.saves as unknown[]) {
    if (!isPlain(e) || typeof e.id !== 'string' || typeof e.savedAt !== 'string') return null;
    if (typeof e.rev !== 'number') return null;
    saves.push({ id: e.id, savedAt: e.savedAt, rev: e.rev });
  }
  if (!body.removed.every((r) => typeof r === 'string')) return null;
  return { line, saves, removed: [...(body.removed as string[])] };
}

function errorOf(body: unknown): string | null {
  return isPlain(body) && typeof body.error === 'string' ? body.error : null;
}

const url = (id: string): string => `/api/game/${encodeURIComponent(id)}`;

/** The sync on the server: state `local`, no listeners, no requests. */
function idleSync(): SaveSync {
  return {
    state: 'local',
    account: null,
    changed() {},
    removed() {},
    pull: () => Promise.resolve(),
    attach() {}
  };
}

class BrowserSync implements SaveSync {
  readonly #storage: Storage | null;
  readonly #fetch: typeof fetch;
  readonly #signedIn: () => boolean;

  #store: GameStore | null = null;
  /** `changed` and `removed` calls made before attach. */
  #early: ['changed' | 'removed', string][] = [];
  /** Above zero while the sync itself calls the store: the store's calls back are its echoes. */
  #echo = 0;
  /** The record as last written; in memory only with no storage. */
  #record: SyncRecord = emptyRecord();

  #account = $state.raw<AccountLine | null>(null);
  /** A PUT answered 200; the browser has a session whatever `signedIn()` says. */
  #putSession = $state(false);
  /** A 401 stopped sending; cleared when `signedIn()` turns true. */
  #signIn = $state(false);
  /** A `too_many` or a `full` store answer, with no `removed` call since. */
  #full = $state(false);
  /** The last request failed by network, 5xx or 429. */
  #offline = $state(false);
  /** How many ids `#record.deleting` holds (reactive mirror of the plain record). */
  #deletingCount = $state(0);
  /** Saves marked waiting to be sent. */
  readonly #waiting = new SvelteSet<string>();
  /** The 2-second debounce per waiting id: the only timer. */
  readonly #timers = new SvelteMap<string, ReturnType<typeof setTimeout>>();
  /** Ids with a request in flight, and its kind. */
  readonly #busy = new SvelteMap<string, 'put' | 'delete'>();
  /** Ids changed while their request was in flight: their timer starts when it ends. */
  readonly #again = new Set<string>();
  /** A pull runs: sends other than its own wait for its end. */
  #pulling = $state(false);
  /** The running pull, returned to every caller while it runs. */
  #running: Promise<void> | null = null;
  /** An adopt in this pull replaced the current game: the page reloads once when it ends. */
  #reloadDue = false;
  /** Ids this pull sent a DELETE for. */
  readonly #pullDeleted = new Set<string>();
  /** Sends and DELETEs in flight, with the handling of their answers. */
  readonly #ops = new Set<Promise<void>>();

  readonly #state: SyncState = $derived.by(() => {
    if (this.#signIn) return 'sign-in';
    if (this.#full) return 'full';
    if (this.#offline && (this.#waiting.size > 0 || this.#deletingCount > 0)) return 'offline';
    if (this.#timers.size > 0 || this.#busy.size > 0 || this.#pulling) return 'saving';
    if (this.#hasSession()) return 'saved';
    return 'local';
  });

  constructor(opts: { storage: Storage | null; fetchFn: typeof fetch; signedIn: () => boolean }) {
    this.#storage = opts.storage;
    this.#fetch = opts.fetchFn;
    this.#signedIn = opts.signedIn;
  }

  get state(): SyncState {
    return this.#state;
  }

  get account(): AccountLine | null {
    return this.#account;
  }

  #hasSession(): boolean {
    return !this.#signIn && (this.#putSession || this.#signedIn());
  }

  // --- the record ---

  #loadRecord(): void {
    const storage = this.#storage;
    if (storage === null) return;
    let text: string | null;
    try {
      text = storage.getItem(SAVE_REVS_KEY);
    } catch {
      return;
    }
    const parsed = text === null ? null : parseRecord(text);
    if (parsed) {
      this.#record = parsed;
    } else if (text !== null) {
      this.#record = emptyRecord();
      this.#writeRecord();
    }
    this.#deletingCount = this.#record.deleting.length;
  }

  #writeRecord(): void {
    this.#deletingCount = this.#record.deleting.length;
    if (this.#storage === null) return;
    try {
      this.#storage.setItem(SAVE_REVS_KEY, JSON.stringify(this.#record));
    } catch {
      // The record in memory stays the truth for this page.
    }
  }

  #see(id: string, rev: number, savedAt: string): void {
    this.#record.seen[id] = { rev, savedAt };
    this.#writeRecord();
  }

  #unsee(id: string): void {
    if (!(id in this.#record.seen)) return;
    delete this.#record.seen[id];
    this.#writeRecord();
  }

  // --- the store, with echoes ignored ---

  #quiet<T>(fn: (store: GameStore) => T): T {
    this.#echo++;
    try {
      return fn(this.#store as GameStore);
    } finally {
      this.#echo--;
    }
  }

  // --- S2 ---

  attach(store: GameStore): void {
    if (this.#store !== null) return;
    this.#store = store;
    this.#loadRecord();
    window.addEventListener('online', () => this.#sendWaiting());
    const early = this.#early;
    this.#early = [];
    for (const [kind, id] of early) {
      if (kind === 'changed') this.changed(id);
      else this.removed(id);
    }
    if (!this.#hasSession()) {
      for (const entry of store.saves) {
        const save = store.read(entry.id);
        if (save === null || save.progress.firstWinAt === null) continue;
        if (this.#record.seen[save.id]?.savedAt === save.savedAt) continue;
        this.#mark(save.id);
      }
    }
    this.#watchSignIn();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (this.#hasSession()) void this.pull();
      else this.#sendWaiting();
    });
    if (this.#signedIn()) void this.pull();
  }

  /** `signedIn()` turning true clears `sign-in` and pulls; turning false ends the session. */
  #watchSignIn(): void {
    let was = untrack(() => this.#signedIn());
    $effect.root(() => {
      $effect(() => {
        const now = this.#signedIn();
        if (now === was) return;
        was = now;
        untrack(() => {
          if (now) {
            this.#signIn = false;
            void this.pull();
          } else {
            this.#putSession = false;
          }
        });
      });
    });
  }

  changed(id: string): void {
    if (this.#echo > 0) return;
    const store = this.#store;
    if (store === null) {
      this.#early.push(['changed', id]);
      return;
    }
    if (!this.#hasSession() && !this.#signIn) {
      const save = store.read(id);
      if (save === null || save.progress.firstWinAt === null) return;
    }
    const retry = this.#offline;
    this.#mark(id);
    if (retry) this.#sendWaiting();
  }

  removed(id: string): void {
    if (this.#echo > 0) return;
    if (this.#store === null) {
      this.#early.push(['removed', id]);
      return;
    }
    this.#stopTimer(id);
    this.#waiting.delete(id);
    this.#again.delete(id);
    if (id in this.#record.seen || this.#busy.get(id) === 'put') {
      if (!this.#record.deleting.includes(id)) {
        this.#record.deleting.push(id);
        this.#writeRecord();
      }
      this.#sendDelete(id);
    }
    this.#full = false;
    this.#sendWaiting();
  }

  pull(): Promise<void> {
    if (this.#store === null || this.#signIn || !this.#hasSession()) return Promise.resolve();
    if (this.#running !== null) return this.#running;
    this.#pulling = true;
    const run = this.#pullNow().finally(() => {
      this.#running = null;
      this.#pulling = false;
      this.#afterPull();
    });
    this.#running = run;
    return run;
  }

  // --- pull ---

  /** Sends that waited for the pull, then the one reload when the current game was replaced. */
  #afterPull(): void {
    const reload = this.#reloadDue;
    this.#reloadDue = false;
    if (!this.#signIn) {
      for (const id of [...this.#waiting]) {
        if (!this.#timers.has(id) && !this.#busy.has(id)) void this.#send(id);
      }
      for (const id of [...this.#record.deleting]) {
        if (!this.#pullDeleted.has(id)) this.#sendDelete(id);
      }
    }
    this.#pullDeleted.clear();
    if (reload) syncReload.reload();
  }

  /** A GET outside the per-save request map. */
  async #get(path: string): Promise<Ended> {
    try {
      const fetchFn = this.#fetch;
      const res = await fetchFn(path, { method: 'GET' });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        // No body, or not JSON.
      }
      return { ok: true, status: res.status, body };
    } catch {
      return { ok: false };
    }
  }

  /** Whether `id` here is as it was last sent or adopted. */
  #unchanged(here: GameSave): boolean {
    return this.#record.seen[here.id]?.savedAt === here.savedAt;
  }

  async #pullNow(): Promise<void> {
    const store = this.#store as GameStore;
    // 1. Wait for in-flight sends to end, then list (at once when none is in flight).
    if (this.#ops.size > 0) await this.#settled();
    const end = await this.#get('/api/game');
    if (end.ok && end.status === 401) return this.#stopForSignIn();
    if (BrowserSync.#failed(end)) {
      this.#offline = true;
      return;
    }
    const list = end.ok && end.status === 200 ? listOf(end.body) : null;
    // Any other answer, or a list that does not read, changes nothing.
    if (list === null) return;
    this.#offline = false;
    this.#account = list.line;

    // 2. Deletes not yet answered.
    for (const id of [...this.#record.deleting]) {
      this.#pullDeleted.add(id);
      this.#sendDelete(id, true);
    }

    // 3. The listed saves, most recent first.
    const listed = new Set(list.saves.map((s) => s.id));
    const removed = new Set(list.removed);
    const order = [...list.saves].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
    let adopting = true;
    for (const entry of order) {
      if (this.#signIn) return;
      const here = store.read(entry.id);
      let due: boolean;
      if (here === null) {
        due = !this.#record.deleting.includes(entry.id);
      } else if (!this.#unchanged(here)) {
        this.#stopTimer(here.id);
        void this.#send(here.id, true);
        due = false;
      } else {
        due = entry.rev > this.#record.seen[here.id].rev;
      }
      if (!due || !adopting) continue;
      adopting = await this.#fetchAndAdopt(entry.id);
    }

    // 4. The saves removed on the account that are here.
    for (const id of removed) {
      if (this.#signIn) return;
      const here = store.read(id);
      if (here === null) continue;
      if (!this.#unchanged(here)) {
        this.#stopTimer(id);
        void this.#send(id, true);
      } else if (id === store.currentId) {
        this.#keepRemoved(id);
      } else {
        const gone = this.#quiet((s) => s.remove(id));
        if (gone.ok) {
          this.#forget(id);
          this.#unsee(id);
        }
      }
    }

    // 5. The saves the account lacks.
    for (const entry of store.saves) {
      if (this.#signIn) return;
      if (listed.has(entry.id) || removed.has(entry.id) || this.#busy.has(entry.id)) continue;
      this.#unsee(entry.id);
      this.#stopTimer(entry.id);
      void this.#send(entry.id, true);
    }
    await this.#settled();
  }

  /** Fetches the account's version of `id` and adopts it. False when adopts must stop. */
  async #fetchAndAdopt(id: string): Promise<boolean> {
    const store = this.#store as GameStore;
    const end = await this.#get(url(id));
    if (end.ok && end.status === 401) {
      this.#stopForSignIn();
      return false;
    }
    if (BrowserSync.#failed(end)) {
      this.#offline = true;
      return true;
    }
    if (!end.ok || end.status !== 200) return true;
    const body = end.body;
    const save = isPlain(body) ? parseGameSave(body.save) : null;
    const rev = isPlain(body) && typeof body.rev === 'number' ? body.rev : null;
    if (save === null || rev === null || save.id !== id) return true;
    const replacing = id === store.currentId;
    const adopted = this.#quiet((s) => s.adopt([save]));
    if (!adopted.ok) {
      if (adopted.reason === 'full') {
        this.#full = true;
        return false;
      }
      this.#offline = true;
      return true;
    }
    this.#see(id, rev, save.savedAt);
    if (replacing) this.#reloadDue = true;
    return true;
  }

  /** Resolves once no send or DELETE is in flight. */
  async #settled(): Promise<void> {
    while (this.#ops.size > 0) await Promise.allSettled([...this.#ops]);
  }

  #track(p: Promise<void>): Promise<void> {
    this.#ops.add(p);
    const done = (): void => {
      this.#ops.delete(p);
    };
    p.then(done, done);
    return p;
  }

  // --- waiting and timers ---

  /** Marks `id` waiting and starts its timer, or, while its request runs, when that ends. */
  #mark(id: string): void {
    this.#waiting.add(id);
    if (this.#signIn) return;
    if (this.#busy.has(id)) this.#again.add(id);
    else this.#startTimer(id);
  }

  #startTimer(id: string): void {
    this.#stopTimer(id);
    this.#timers.set(
      id,
      setTimeout(() => {
        this.#timers.delete(id);
        void this.#send(id);
      }, DEBOUNCE_MS)
    );
  }

  #stopTimer(id: string): void {
    const t = this.#timers.get(id);
    if (t === undefined) return;
    clearTimeout(t);
    this.#timers.delete(id);
  }

  /** Sends now every waiting save with no timer and no request, and every unanswered DELETE. */
  #sendWaiting(): void {
    if (this.#signIn) return;
    for (const id of [...this.#waiting]) {
      if (!this.#timers.has(id) && !this.#busy.has(id)) void this.#send(id);
    }
    for (const id of [...this.#record.deleting]) this.#sendDelete(id);
  }

  /** With no session, the next waiting save that is held for the one PUT in flight. */
  #sendNextHeld(): void {
    if (this.#signIn || this.#hasSession()) return;
    for (const id of this.#waiting) {
      if (!this.#timers.has(id) && !this.#busy.has(id)) {
        void this.#send(id);
        return;
      }
    }
  }

  // --- requests ---

  async #request(id: string, kind: 'put' | 'delete', init: RequestInit): Promise<Ended> {
    this.#busy.set(id, kind);
    try {
      // Called with no receiver: the global `fetch` throws when called on another object.
      const fetchFn = this.#fetch;
      const res = await fetchFn(url(id), init);
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        // No body, or not JSON.
      }
      return { ok: true, status: res.status, body };
    } catch {
      return { ok: false };
    } finally {
      this.#busy.delete(id);
    }
  }

  /** A network failure, a 5xx or a 429. */
  static #failed(end: Ended): boolean {
    return !end.ok || end.status === 429 || end.status >= 500;
  }

  /** 401: state `sign-in`, and the browser has no session. */
  #stopForSignIn(): void {
    this.#signIn = true;
    this.#putSession = false;
    for (const id of [...this.#timers.keys()]) this.#stopTimer(id);
    this.#again.clear();
  }

  /** Sends `id`; while a pull runs only the pull's own sends (`now`) go, the rest wait for its end. */
  #send(id: string, now = false): Promise<void> {
    if (this.#pulling && !now) {
      if (this.#store?.read(id)) this.#waiting.add(id);
      return Promise.resolve();
    }
    return this.#track(this.#put(id));
  }

  async #put(id: string): Promise<void> {
    const store = this.#store;
    if (store === null || this.#signIn || this.#busy.has(id)) return;
    const save = store.read(id);
    if (save === null) {
      this.#waiting.delete(id);
      return;
    }
    const session = this.#hasSession();
    if (!session) {
      if (save.progress.firstWinAt === null) {
        this.#waiting.delete(id);
        return;
      }
      // At most one PUT in flight with no session: two could make two accounts.
      if ([...this.#busy.values()].includes('put')) return;
    }
    this.#waiting.delete(id);
    const baseRev = this.#record.seen[id]?.rev ?? null;
    const end = await this.#request(id, 'put', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRev, save })
    });
    this.#answered(id, save, session, end);
    if (this.#again.delete(id) && this.#waiting.has(id) && !this.#signIn) this.#startTimer(id);
    if (this.#record.deleting.includes(id)) this.#sendDelete(id);
    if (!BrowserSync.#failed(end)) this.#sendNextHeld();
  }

  #answered(id: string, save: GameSave, session: boolean, end: Ended): void {
    if (BrowserSync.#failed(end)) {
      this.#offline = true;
      this.#waiting.add(id);
      return;
    }
    if (!end.ok) return;
    this.#offline = false;
    const { status, body } = end;
    if (status === 200) {
      const rev = isPlain(body) && typeof body.rev === 'number' ? body.rev : null;
      const line = lineOf(body);
      if (line) this.#account = line;
      if (rev !== null) this.#see(id, rev, save.savedAt);
      if (!session && !this.#signIn) this.#sessionMade(id);
      return;
    }
    if (status === 409) return this.#keepBoth(id, body);
    if (status === 410) return this.#keepRemoved(id);
    if (status === 401) return this.#stopForSignIn();
    const error = status === 422 ? errorOf(body) : null;
    if (error === 'too_many') {
      this.#full = true;
      this.#waiting.add(id);
      return;
    }
    if (error === 'no_win') return;
    // 413, 422 invalid and any other answer: a defect, never a player's act.
    console.error('save sync: the account refused a saved game', id, status);
  }

  /** The PUT that made the account: every other saved game here is marked waiting and sent. */
  #sessionMade(id: string): void {
    this.#putSession = true;
    for (const entry of (this.#store as GameStore).saves) {
      if (entry.id !== id) this.#waiting.add(entry.id);
    }
    this.#sendWaiting();
  }

  /** 409: the browser's version under a new id named "(this device)", the account's under `a`. */
  #keepBoth(a: string, body: unknown): void {
    const store = this.#store as GameStore;
    const theirs = isPlain(body) ? parseGameSave(body.save) : null;
    const rev = isPlain(body) && typeof body.rev === 'number' ? body.rev : null;
    const mine = store.read(a);
    if (theirs === null || rev === null || theirs.id !== a) {
      console.error('save sync: the account refused a saved game', a, 409);
      return;
    }
    if (mine === null) return;
    const b = newId();
    const name = defaultSaveName(
      { kind: 'conflict', name: mine.name },
      store.saves.map((s) => s.name)
    );
    if (!this.#quiet((s) => s.rekey(a, b)).ok) {
      this.#offline = true;
      this.#waiting.add(a);
      return;
    }
    this.#forget(a);
    this.#quiet((s) => s.rename(b, name));
    const adopted = this.#quiet((s) => s.adopt([theirs]));
    if (adopted.ok) {
      this.#see(a, rev, theirs.savedAt);
    } else {
      if (adopted.reason === 'full') this.#full = true;
      this.#unsee(a);
    }
    this.#unsee(b);
    void this.#send(b);
  }

  /** 410: kept here under a new id and sent fresh (D8). */
  #keepRemoved(id: string): void {
    if ((this.#store as GameStore).read(id) === null) return;
    const fresh = newId();
    if (!this.#quiet((s) => s.rekey(id, fresh)).ok) {
      this.#offline = true;
      this.#waiting.add(id);
      return;
    }
    this.#forget(id);
    this.#unsee(id);
    void this.#send(fresh);
  }

  /** Drops what waits for `id`, whose content now lives under another id. */
  #forget(id: string): void {
    this.#stopTimer(id);
    this.#waiting.delete(id);
    this.#again.delete(id);
  }

  #sendDelete(id: string, now = false): void {
    if (!this.#hasSession() || this.#busy.has(id) || (this.#pulling && !now)) return;
    void this.#track(this.#deleteNow(id));
  }

  async #deleteNow(id: string): Promise<void> {
    return this.#request(id, 'delete', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    }).then((end) => {
      if (end.ok && end.status === 204) {
        this.#offline = false;
        this.#record.deleting = this.#record.deleting.filter((d) => d !== id);
        delete this.#record.seen[id];
        this.#writeRecord();
      } else if (end.ok && end.status === 401) {
        this.#offline = false;
        this.#stopForSignIn();
      } else {
        // Any other answer, or none: a failure; the id stays in `deleting` and goes again.
        this.#offline = true;
      }
    });
  }
}

export function createSaveSync(opts: {
  storage: Storage | null;
  fetchFn: typeof fetch;
  /** Whether the root layout's `user` is set now. */
  signedIn: () => boolean;
}): SaveSync {
  // `src/lib` never imports `$app/*` (vite.config.client-test.ts): this is `browser`.
  if (typeof window === 'undefined') return idleSync();
  return new BrowserSync(opts);
}
