// Every query on `game_save`. The routes and the two hooks (account link, account
// deletion) call this module; nothing else touches the table. A stored body is parsed
// only to answer it back, and only its top-level `id` is ever rewritten (moveGames).
import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Database } from '$lib/server/db';
import { gameSave, handleTombstone } from '$lib/server/db/schema';
import type { AccountLine } from '$lib/game/save-api';
import { MAX_SAVES, parseGameSave, type GameSave, type SaveEntry } from '$lib/game/saves';
import type { Level } from '$lib/game/levels';
import { newId } from '$lib/ids/base58';

export const REMOVED_LIST_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

type Row = typeof gameSave.$inferSelect;

function bodyOf(row: Row): GameSave {
  const save = parseGameSave(JSON.parse(row.body));
  if (!save) throw new Error(`game_save ${row.identityId}/${row.id}: stored body is not a save`);
  return save;
}

function rowKey(identityId: string, id: string) {
  return and(eq(gameSave.identityId, identityId), eq(gameSave.id, id));
}

async function readRow(db: Database, identityId: string, id: string): Promise<Row | undefined> {
  const [row] = await db.select().from(gameSave).where(rowKey(identityId, id));
  return row;
}

export async function accountLine(
  db: Database,
  user: { id: string; handle: string }
): Promise<AccountLine> {
  const [claimed] = await db
    .select({ handle: handleTombstone.handle })
    .from(handleTombstone)
    .where(eq(handleTombstone.releasedBy, user.id))
    .limit(1);
  return { handle: user.handle, handleClaimed: claimed !== undefined };
}

export async function listGames(
  db: Database,
  identityId: string,
  now: Date
): Promise<{ saves: (SaveEntry & { rev: number })[]; removed: string[] }> {
  const live = await db
    .select({
      id: gameSave.id,
      name: gameSave.name,
      nameIsDefault: sql<number>`json_extract(${gameSave.body}, '$.nameIsDefault')`,
      savedAt: gameSave.savedAt,
      level: gameSave.level,
      rev: gameSave.rev
    })
    .from(gameSave)
    .where(and(eq(gameSave.identityId, identityId), isNull(gameSave.removedAt)))
    .orderBy(desc(gameSave.savedAt));
  const since = new Date(now.getTime() - REMOVED_LIST_DAYS * DAY_MS);
  const removed = await db
    .select({ id: gameSave.id })
    .from(gameSave)
    .where(
      and(
        eq(gameSave.identityId, identityId),
        isNotNull(gameSave.removedAt),
        gte(gameSave.removedAt, since)
      )
    );
  return {
    saves: live.map((r) => ({
      id: r.id,
      name: r.name,
      nameIsDefault: Boolean(r.nameIsDefault),
      savedAt: r.savedAt.toISOString(),
      level: r.level as Level,
      rev: r.rev
    })),
    removed: removed.map((r) => r.id)
  };
}

export async function readGame(
  db: Database,
  identityId: string,
  id: string
): Promise<{ kind: 'live'; rev: number; save: GameSave } | { kind: 'removed' } | null> {
  const row = await readRow(db, identityId, id);
  if (!row) return null;
  if (row.removedAt !== null) return { kind: 'removed' };
  return { kind: 'live', rev: row.rev, save: bodyOf(row) };
}

type PutAnswer =
  | { kind: 'stored'; rev: number }
  | { kind: 'conflict'; rev: number; save: GameSave }
  | { kind: 'removed' }
  | { kind: 'too_many' };

/** The answer for a row that exists and was not written. */
function notWritten(row: Row): PutAnswer {
  if (row.removedAt !== null) return { kind: 'removed' };
  return { kind: 'conflict', rev: row.rev, save: bodyOf(row) };
}

export async function putGame(
  db: Database,
  identityId: string,
  save: GameSave,
  baseRev: number | null
): Promise<PutAnswer> {
  const body = JSON.stringify(save);
  const savedAt = new Date(save.savedAt);
  const row = await readRow(db, identityId, save.id);

  if (!row) {
    // The guards live in the write: no row under this id, and fewer than MAX_SAVES live rows.
    const inserted = await db.all<{ rev: number }>(sql`
      INSERT INTO game_save (identity_id, id, rev, name, level, body, saved_at, removed_at)
      SELECT ${identityId}, ${save.id}, 1, ${save.name}, ${save.progress.level}, ${body},
        ${savedAt.getTime()}, NULL
      WHERE NOT EXISTS (
          SELECT 1 FROM game_save WHERE identity_id = ${identityId} AND id = ${save.id}
        )
        AND (
          SELECT count(*) FROM game_save WHERE identity_id = ${identityId} AND removed_at IS NULL
        ) < ${MAX_SAVES}
      RETURNING rev`);
    if (inserted.length > 0) return { kind: 'stored', rev: inserted[0].rev };
    const now = await readRow(db, identityId, save.id);
    return now ? notWritten(now) : { kind: 'too_many' };
  }

  if (row.removedAt !== null || baseRev !== row.rev) return notWritten(row);

  const updated = await db
    .update(gameSave)
    .set({
      rev: sql`${gameSave.rev} + 1`,
      body,
      name: save.name,
      level: save.progress.level,
      savedAt
    })
    .where(and(rowKey(identityId, save.id), eq(gameSave.rev, baseRev), isNull(gameSave.removedAt)))
    .returning({ rev: gameSave.rev });
  if (updated.length > 0) return { kind: 'stored', rev: updated[0].rev };
  const now = await readRow(db, identityId, save.id);
  // A row is never deleted except with its account; if it is gone, the account is too.
  return now ? notWritten(now) : { kind: 'removed' };
}

export async function removeGame(
  db: Database,
  identityId: string,
  id: string,
  now: Date
): Promise<void> {
  await db
    .update(gameSave)
    .set({ body: '', removedAt: now })
    .where(and(rowKey(identityId, id), isNull(gameSave.removedAt)));
}

export async function moveGames(
  db: Database,
  survivorId: string,
  absorbedId: string
): Promise<void> {
  const absorbed = await db
    .select({ id: gameSave.id, removedAt: gameSave.removedAt })
    .from(gameSave)
    .where(eq(gameSave.identityId, absorbedId));
  if (absorbed.length === 0) return;
  const held = new Set(
    (
      await db.select({ id: gameSave.id }).from(gameSave).where(eq(gameSave.identityId, survivorId))
    ).map((r) => r.id)
  );

  const ops: BatchItem<'sqlite'>[] = [];
  for (const r of absorbed) {
    if (!held.has(r.id)) continue;
    if (r.removedAt === null) {
      // Re-keyed in place: the row arrives under a new id with its body's id rewritten.
      const nid = newId();
      ops.push(
        db
          .update(gameSave)
          .set({
            identityId: survivorId,
            id: nid,
            body: sql`json_set(${gameSave.body}, '$.id', ${nid})`
          })
          .where(rowKey(absorbedId, r.id))
      );
    } else {
      ops.push(db.delete(gameSave).where(rowKey(absorbedId, r.id)));
    }
  }
  ops.push(
    db.update(gameSave).set({ identityId: survivorId }).where(eq(gameSave.identityId, absorbedId))
  );
  await db.batch(ops as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
}

export async function deleteGamesOf(db: Database, identityIds: string[]): Promise<void> {
  if (identityIds.length === 0) return;
  await db.delete(gameSave).where(inArray(gameSave.identityId, identityIds));
}
