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
  readonly #locks: LocksLike | null;
  readonly #channel: ChannelLike | null;
  readonly #abort = new AbortController();
  readonly #watching = new Set<string>();
  readonly #told = new Set<string>();
  readonly #listeners = new Set<(owner: string) => void>();
  #release: (() => void) | null = null;
  #started = false;
  #stopped = false;

  constructor(o: { tabId: string; locks: LocksLike | null; channel: ChannelLike | null }) {
    this.#tabId = o.tabId;
    this.#locks = o.locks;
    this.#channel = o.channel;
  }

  /**
   * Holds TAB_LOCK_PREFIX + tabId until stop(); resolves once it is held; then posts
   * { type: 'here', tabId, reply: false }. Without Web Locks resolves at once. A second call,
   * or a call after stop(), does nothing.
   */
  async start(): Promise<void> {
    if (this.#started || this.#stopped) return;
    this.#started = true;
    this.#channel?.addEventListener('message', this.#onMessage);
    const locks = this.#locks;
    if (locks !== null) {
      await new Promise<void>((held) => {
        const hold = new Promise<void>((release) => {
          this.#release = release;
        });
        locks
          .request(TAB_LOCK_PREFIX + this.#tabId, {}, () => {
            held();
            return hold;
          })
          .catch((e: unknown) => {
            console.error(`sim-sync: tab lock failed: ${errorName(e)}`);
            held();
          });
      });
    }
    if (this.#stopped) return;
    this.#post({ type: 'here', tabId: this.#tabId, reply: false });
  }

  /**
   * Of `owners`, those whose lock is not held, never this tab. Without Web Locks: every owner
   * but this tab.
   */
  async goneOwners(owners: readonly string[]): Promise<string[]> {
    const others = owners.filter((o) => o !== this.#tabId);
    if (this.#locks === null) return others;
    const snapshot = await this.#locks.query();
    const held = new Set((snapshot.held ?? []).map((l) => l.name));
    return others.filter((o) => !held.has(TAB_LOCK_PREFIX + o));
  }

  /**
   * Waits for `owner`'s lock, releases it at once, then tells onGone, once per owner. Never
   * this tab; nothing without Web Locks or after stop().
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
            console.error(`sim-sync: tab watch failed: ${errorName(e)}`);
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

  /** Releases the lock, aborts the watches (nothing is told), closes the channel. */
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
      console.error(`sim-sync: tab post failed: ${errorName(e)}`);
    }
  }

  readonly #onMessage = (e: MessageEvent): void => {
    const m = readHere(e.data);
    if (m === null || m.tabId === this.#tabId) return;
    this.watch(m.tabId);
    if (!m.reply) this.#post({ type: 'here', tabId: this.#tabId, reply: true });
  };
}
