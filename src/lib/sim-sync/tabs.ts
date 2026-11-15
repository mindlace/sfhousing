import type { ChannelLike, LocksLike } from './ports';
import { errorName } from './ports';

export const TAB_LOCK_PREFIX = 'sfh-tab:';
export const TAB_CHANNEL = 'sfh-sim';

/** The one channel message: a tab says it is here; a reply is the answer to such a message. */
interface Here {
  type: 'here';
  tabId: string;
  reply: boolean;
}

function readHere(data: unknown): Here | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.type !== 'here' || typeof d.tabId !== 'string' || typeof d.reply !== 'boolean') {
    return null;
  }
  return { type: 'here', tabId: d.tabId, reply: d.reply };
}

/**
 * How a tab says it is alive and learns when another is not. A live tab holds the Web Lock
 * named TAB_LOCK_PREFIX + its id for as long as it lives (the browser frees it when the tab
 * goes, however it goes). A tab's unsent commits may be taken only by a tab that has seen its
 * lock free: goneOwners() reads the lock table, watch() waits for the lock. Without Web Locks
 * (a null port) every owner but this tab counts as gone, asked at open only, and nothing is
 * watched. The channel carries only tab ids: a tab announces itself once its lock is held, and
 * each tab that hears it watches it and answers, so both watch each other.
 */
export class TabPresence {
  readonly #tabId: string;
  #locks: LocksLike | null;
  readonly #channel: ChannelLike | null;
  readonly #abort = new AbortController();
  readonly #watching = new Set<string>();
  readonly #told = new Set<string>();
  readonly #listeners = new Set<(owner: string) => void>();
  #release: (() => void) | null = null;
  #starting: Promise<boolean> | null = null;
  #holding = false;
  #stopped = false;

  /**
   * `tabId` is unique per instance and never reused: a new TabPresence, even in the same tab
   * after a reload, gets a new id.
   */
  constructor(o: { tabId: string; locks: LocksLike | null; channel: ChannelLike | null }) {
    this.#tabId = o.tabId;
    this.#locks = o.locks;
    this.#channel = o.channel;
  }

  /**
   * Holds TAB_LOCK_PREFIX + tabId until stop(); resolves true once it is held and announced
   * ({ type: 'here', tabId, reply: false } on the channel). Resolves false, announcing nothing,
   * when this tab holds no lock: there is no Web Locks, or the request for its own lock failed
   * (logged). From then on the tab behaves as with no Web Locks (goneOwners reports every other
   * owner, watch does nothing) and answers no announcement: a tab that does not hold its lock
   * never invites others to watch it. A second call while the first waits returns the first
   * call's promise; after stop() it resolves false.
   */
  start(): Promise<boolean> {
    if (this.#starting !== null) return this.#starting;
    if (this.#stopped) return Promise.resolve(false);
    this.#starting = this.#start();
    return this.#starting;
  }

  async #start(): Promise<boolean> {
    this.#channel?.addEventListener('message', this.#onMessage);
    const locks = this.#locks;
    if (locks === null) return false;
    const held = await new Promise<boolean>((resolve) => {
      const hold = new Promise<void>((release) => {
        this.#release = release;
      });
      locks
        .request(TAB_LOCK_PREFIX + this.#tabId, {}, () => {
          resolve(true);
          return hold;
        })
        .catch((e: unknown) => {
          console.error(`[sim-sync] tab lock failed: ${errorName(e)}`);
          resolve(false);
        });
    });
    if (!held) {
      this.#locks = null;
      return false;
    }
    if (this.#stopped) return false;
    this.#holding = true;
    this.#post({ type: 'here', tabId: this.#tabId, reply: false });
    return true;
  }

  /**
   * Of `owners`, those whose lock is not held, never this tab. Without Web Locks (or when this
   * tab's own lock could not be had): every owner but this tab, so the caller asks at open
   * only and never to find out later that a tab has gone.
   */
  async goneOwners(owners: readonly string[]): Promise<string[]> {
    const others = owners.filter((o) => o !== this.#tabId);
    if (this.#locks === null) return others;
    const snapshot = await this.#locks.query();
    const held = new Set((snapshot.held ?? []).map((l) => l.name));
    return others.filter((o) => !held.has(TAB_LOCK_PREFIX + o));
  }

  /**
   * Waits for `owner`'s lock, releases it at once, then tells onGone, once per owner until the
   * owner announces itself again. Never this tab; nothing without Web Locks or after stop().
   */
  watch(owner: string): void {
    const locks = this.#locks;
    if (locks === null || this.#stopped || owner === this.#tabId) return;
    if (this.#watching.has(owner) || this.#told.has(owner)) return;
    this.#watching.add(owner);
    locks
      .request(TAB_LOCK_PREFIX + owner, { signal: this.#abort.signal }, () => undefined)
      .then(
        () => {
          this.#watching.delete(owner);
          if (this.#stopped || this.#told.has(owner)) return;
          this.#told.add(owner);
          for (const fn of [...this.#listeners]) fn(owner);
        },
        (e: unknown) => {
          this.#watching.delete(owner);
          if (errorName(e) !== 'AbortError') {
            console.error(`[sim-sync] tab watch failed: ${errorName(e)}`);
          }
        }
      );
  }

  /** The owners being watched now (tests and diagnostics). */
  watching(): string[] {
    return [...this.#watching];
  }

  onGone(fn: (owner: string) => void): () => void {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  }

  /**
   * Releases the lock, aborts the watches (nothing is told), closes the channel. After it other
   * tabs may take this tab's unsent commits: the caller stops sending and closes its store
   * first.
   */
  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#abort.abort();
    this.#watching.clear();
    this.#release?.();
    this.#channel?.removeEventListener('message', this.#onMessage);
    this.#channel?.close();
  }

  #post(m: Here): void {
    if (this.#stopped) return;
    try {
      this.#channel?.postMessage(m);
    } catch (e) {
      console.error(`[sim-sync] tab post failed: ${errorName(e)}`);
    }
  }

  readonly #onMessage = (e: MessageEvent): void => {
    const m = readHere(e.data);
    if (m === null || m.tabId === this.#tabId) return;
    this.#told.delete(m.tabId);
    this.watch(m.tabId);
    if (!m.reply && this.#holding) this.#post({ type: 'here', tabId: this.#tabId, reply: true });
  };
}
