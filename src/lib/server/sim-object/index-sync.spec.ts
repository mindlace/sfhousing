import { afterEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { freshDb, seedUser } from '$lib/server/test/auth-db';
import { createSimRecord } from '$lib/server/sims/sim-index';
import { simCommit, simIndex } from '$lib/server/db/schema';
import type { Commit } from '$lib/sim-log';
import { envelopeRow, syncSimIndex, type IndexedCommit, type IndexSummary } from './index-sync';

const opened: Array<() => void> = [];
afterEach(() => {
  for (const close of opened.splice(0)) close();
});

const T0 = 1_700_000_000_000;

function commit(seq: number, over: Partial<Commit> = {}): IndexedCommit {
  return {
    bytes: 300 + seq,
    commit: {
      id: `id-${seq}`,
      parent: seq - 1,
      kind: 'edit',
      label: 'Rename',
      restores: null,
      datasetVersion: 'fixture-0',
      shapes: 1,
      build: 'b1',
      source: 'sim.name',
      changes: [{ op: 'set', key: 'sim', field: 'name', value: `N${seq}` }],
      seq,
      actor: 'u1',
      at: T0 + seq,
      hash: 'a'.repeat(64),
      ...over
    }
  };
}

const summary = (positions: number, title = 'Garden'): IndexSummary => ({
  positions,
  lastChangeAt: T0 + positions,
  datasetVersion: 'fixture-0',
  title
});

async function setup(sims = ['s1']) {
  const t = freshDb();
  opened.push(t.close);
  await seedUser(t.db, { id: 'u1', email: 'u1@test.com' });
  for (const simId of sims)
    await createSimRecord({ db: t.db, simId, title: 'Garden', managerId: 'u1' });
  return t;
}

const indexRow = async (db: Awaited<ReturnType<typeof setup>>['db'], simId: string) =>
  (await db.select().from(simIndex).where(eq(simIndex.simId, simId)))[0];

describe('envelopeRow', () => {
  it('copies the envelope and leaves the changes out', () => {
    const row = envelopeRow(
      's1',
      commit(3, { kind: 'restore', restores: { position: 1, as: 'undo' } })
    );
    expect(row).toEqual({
      simId: 's1',
      seq: 3,
      kind: 'restore',
      source: 'sim.name',
      actor: 'u1',
      at: new Date(T0 + 3),
      build: 'b1',
      datasetVersion: 'fixture-0',
      bytes: 303,
      restoresPosition: 1,
      restoresAs: 'undo'
    });
  });

  it('writes null restores for an edit', () => {
    expect(envelopeRow('s1', commit(1))).toMatchObject({
      restoresPosition: null,
      restoresAs: null
    });
  });
});

describe('syncSimIndex', () => {
  it('a new sim_index row starts with no positions and no copies', async () => {
    const { db } = await setup();
    expect(await indexRow(db, 's1')).toMatchObject({
      positions: 0,
      lastChangeAt: null,
      datasetVersion: null,
      remixedFrom: null,
      remixedFromPosition: null
    });
  });

  it('writes each envelope and the index columns', async () => {
    const { db } = await setup();
    await syncSimIndex(db, 's1', [commit(1), commit(2)], summary(2, 'Renamed'));
    const rows = await db.select().from(simCommit).orderBy(asc(simCommit.seq));
    expect(rows.map((r) => [r.simId, r.seq, r.bytes])).toEqual([
      ['s1', 1, 301],
      ['s1', 2, 302]
    ]);
    expect(await indexRow(db, 's1')).toMatchObject({
      positions: 2,
      title: 'Renamed',
      datasetVersion: 'fixture-0',
      lastChangeAt: new Date(T0 + 2)
    });
  });

  it('is idempotent and never moves the index backwards', async () => {
    const { db } = await setup();
    await syncSimIndex(db, 's1', [commit(1), commit(2)], summary(2, 'B'));
    await syncSimIndex(db, 's1', [commit(1), commit(2)], summary(2, 'B'));
    await syncSimIndex(db, 's1', [commit(1)], summary(1, 'A'));
    expect(await db.select().from(simCommit)).toHaveLength(2);
    expect(await indexRow(db, 's1')).toMatchObject({ positions: 2, title: 'B' });
  });

  it('leaves other sims alone', async () => {
    const { db } = await setup(['s1', 's2']);
    await syncSimIndex(db, 's1', [commit(1)], summary(1));
    expect(await indexRow(db, 's2')).toMatchObject({ positions: 0, title: 'Garden' });
  });

  it('writes nothing for an empty batch', async () => {
    const { db } = await setup();
    await syncSimIndex(db, 's1', [], summary(0));
    expect(await db.select().from(simCommit)).toHaveLength(0);
    expect(await indexRow(db, 's1')).toMatchObject({ positions: 0 });
  });
});
