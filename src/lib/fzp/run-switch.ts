/**
 * Latest-wins request queue for switching runs: at most one request in flight and one waiting
 * seed. A fast drag therefore shows the most recent run the worker can finish, not nothing until
 * the drag slows.
 */
export class RunSwitcher {
  #send: (seed: number | null) => number;
  #inFlight: { seed: number | null; rev: number } | null = null;
  #waiting: { seed: number | null } | null = null;

  constructor(send: (seed: number | null) => number) {
    this.#send = send;
  }

  /** Latest wins: sends at once when nothing is in flight, else replaces the waiting seed. */
  select(seed: number | null): void {
    if (this.#inFlight) this.#waiting = { seed };
    else this.#start(seed);
  }

  /** A non-stale timeline at `rev`: ends the in-flight request when rev >= its rev. */
  answer(rev: number): { seed: number | null } | undefined {
    return this.#end(rev, true);
  }

  /** An error at `rev`: like `answer` for the in-flight request it names, but a failure. */
  fail(rev: number): { seed: number | null } | undefined {
    return this.#end(rev, false);
  }

  /** Drops the in-flight and waiting requests (a new session, a crash, a lever change). */
  reset(): void {
    this.#inFlight = null;
    this.#waiting = null;
  }

  get settled(): boolean {
    return this.#inFlight === null && this.#waiting === null;
  }

  #start(seed: number | null) {
    this.#inFlight = { seed, rev: this.#send(seed) };
  }

  #end(rev: number, skipAnswered: boolean): { seed: number | null } | undefined {
    const done = this.#inFlight;
    if (!done || rev < done.rev) return undefined;
    this.#inFlight = null;
    const next = this.#waiting;
    this.#waiting = null;
    if (next && !(skipAnswered && next.seed === done.seed)) this.#start(next.seed);
    return { seed: done.seed };
  }
}
