// The index pass (R41): copies stored commits to D1 after they were sent, one pass at a time, and
// its order with a takedown. Platform-free, so a Node spec drives it; the class supplies the D1
// write and the alarm.
import { LogError } from '$lib/sim-log';
import type { IndexSummary, IndexedCommit } from './index-sync';
import { INDEX_BATCH } from './limits';
import type { LogHost } from './log-host';
import { loggable } from './object-rules';

export type IndexSource = Pick<LogHost, 'gone' | 'unindexed' | 'summary' | 'markIndexed'>;

export interface IndexRunnerOptions {
  /** ctx.id.name: absent only if the object was not reached by name. */
  simId: string | undefined;
  /** The D1 write of one batch (syncSimIndex). */
  sync: (simId: string, commits: readonly IndexedCommit[], summary: IndexSummary) => Promise<void>;
  /** Sets the retry alarm if none is set. */
  armRetry: () => Promise<void>;
  batch?: number;
}

export class IndexRunner {
  readonly #source: IndexSource;
  readonly #opts: IndexRunnerOptions;
  #pass: Promise<void> | null = null;
  /** The D1 write failed last time: the next failure is not logged again. */
  #failing = false;
  #noIdLogged = false;

  constructor(source: IndexSource, opts: IndexRunnerOptions) {
    this.#source = source;
    this.#opts = opts;
  }

  /** Starts a pass, or returns the one in flight (it picks up rows stored meanwhile). Never
   *  rejects. */
  kick(): Promise<void> {
    return (this.#pass ??= this.#run());
  }

  /** Resolves when the pass in flight, if any, has ended. Never rejects. */
  settled(): Promise<void> {
    return this.#pass ?? Promise.resolve();
  }

  async #run(): Promise<void> {
    // Yield first, so #pass is set before the pass reads anything.
    await Promise.resolve();
    const src = this.#source;
    const simId = this.#opts.simId;
    const n = this.#opts.batch ?? INDEX_BATCH;
    try {
      if (!simId) {
        if (!this.#noIdLogged) {
          this.#noIdLogged = true;
          console.error('[sim-object] index pass has no sim id', '-');
        }
        return;
      }
      // Rows stored during an await are picked up by the next unindexed(); the last check and
      // the reset of #pass (finally) run with no await between them, so no kick is lost.
      for (let batch = src.unindexed(n); batch.length > 0; batch = src.unindexed(n)) {
        await this.#opts.sync(simId, batch, src.summary());
        // Taken down during the write: the watermark stays at 0, and takeDown() is waiting for
        // this pass, so its caller deletes the D1 rows after this write.
        if (src.gone()) return;
        src.markIndexed(batch[batch.length - 1].commit.seq);
        this.#failing = false;
      }
    } catch (e) {
      if (e instanceof LogError) {
        // The stored rows do not fold on this build (a newer build wrote them). Retrying cannot
        // help; a newer build re-arms the pass on construction (indexBehind).
        console.error('[sim-object] index summary failed', simId, loggable(e));
        return;
      }
      if (!this.#failing) {
        this.#failing = true;
        console.error('[sim-object] index write failed', simId, loggable(e));
      }
      try {
        await this.#opts.armRetry();
      } catch (e2) {
        console.error('[sim-object] index retry not scheduled', simId, loggable(e2));
      }
    } finally {
      this.#pass = null;
    }
  }
}

/**
 * takeDown()'s order: clear the log, then wait for the index pass in flight (it stops without
 * moving the watermark), then close the sockets. No index write lands after this returns.
 */
export async function takeDownInOrder(
  host: Pick<LogHost, 'takeDown'>,
  runner: IndexRunner,
  now: number,
  closeAll: () => void
): Promise<void> {
  await host.takeDown(now);
  await runner.settled();
  closeAll();
}
