import { and, eq, lt } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Database } from '$lib/server/db';
import { simCommit, simIndex } from '$lib/server/db/schema';
import type { Commit } from '$lib/sim-log';

/** One stored commit and the UTF-8 size of its stored body. */
export interface IndexedCommit {
  commit: Commit;
  bytes: number;
}

/** What the index row copies from the log's tip (R24, R42). */
export interface IndexSummary {
  positions: number;
  lastChangeAt: number;
  datasetVersion: string | null;
  title: string;
}

/** A commit's envelope: every field but its changes. */
export function envelopeRow(simId: string, c: IndexedCommit): typeof simCommit.$inferInsert {
  const { commit } = c;
  return {
    simId,
    seq: commit.seq,
    kind: commit.kind,
    source: commit.source,
    actor: commit.actor,
    at: new Date(commit.at),
    build: commit.build,
    datasetVersion: commit.datasetVersion,
    bytes: c.bytes,
    restoresPosition: commit.restores?.position ?? null,
    restoresAs: commit.restores?.as ?? null
  };
}

/**
 * Copy commits' envelopes and the log's tip into D1 in one batch. Replays are harmless
 * and the index never moves backwards: the update applies only to a longer log.
 */
export async function syncSimIndex(
  db: Database,
  simId: string,
  commits: readonly IndexedCommit[],
  summary: IndexSummary
): Promise<void> {
  if (commits.length === 0) return;
  const at = new Date(summary.lastChangeAt);
  const statements: BatchItem<'sqlite'>[] = commits.map((c) =>
    db.insert(simCommit).values(envelopeRow(simId, c)).onConflictDoNothing()
  );
  statements.push(
    db
      .update(simIndex)
      .set({
        positions: summary.positions,
        lastChangeAt: at,
        datasetVersion: summary.datasetVersion,
        title: summary.title,
        updatedAt: at
      })
      .where(and(eq(simIndex.simId, simId), lt(simIndex.positions, summary.positions)))
  );
  await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
}
