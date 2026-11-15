import { afterEach, describe, expect, it, vi } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm';
import { SHAPES_REVISION } from '$lib/sim-log';
import type { RefusedWhy } from '$lib/sim-stream/protocol';
import { headerTitle } from '$lib/server/sim-object/open-params';
import { loggable, QUERY_FAILED } from '$lib/server/sim-object/object-rules';
import type { ServerAppendResult } from '$lib/server/sim-object/object-rules';
import { freshDb, seedSim, seedUser } from '$lib/server/test/auth-db';
import { mockConsole } from '$lib/server/test/mock-console';
import { renameDraft, renameSim, type AppendAsStub } from './rename';

const STAMP = { datasetVersion: 'fixture-0', build: 'test-build' };
const ACTOR = 'ident-7Hx9QpL2';

const opened: Array<() => void> = [];
afterEach(() => {
  for (const close of opened.splice(0)) close();
  vi.restoreAllMocks();
});

async function setup(title = '  Garden  ') {
  const t = freshDb();
  opened.push(t.close);
  await seedUser(t.db, { id: 'm1', email: 'm1@test.com' });
  const simId = await seedSim(t.db, { title, managerId: 'm1' });
  return { db: t.db, simId };
}

function stubAnswering(answer: () => Promise<ServerAppendResult>) {
  const appendAs = vi.fn<AppendAsStub['appendAs']>(answer);
  return { stub: { appendAs } satisfies AppendAsStub, appendAs };
}

const accepted = async (): Promise<ServerAppendResult> => ({ kind: 'accepted', seq: 2 });

describe('renameDraft', () => {
  it('is an edit setting the sim name, with no parent and no dataset version', () => {
    const d = renameDraft('After', 'b1');
    expect(d).toEqual({
      id: expect.any(String),
      kind: 'edit',
      label: 'Rename',
      restores: null,
      shapes: SHAPES_REVISION,
      build: 'b1',
      source: 'sim.name',
      changes: [{ op: 'set', key: 'sim', field: 'name', value: 'After' }]
    });
    expect(d).not.toHaveProperty('parent');
    expect(d).not.toHaveProperty('datasetVersion');
    expect(renameDraft('After', 'b1').id).not.toBe(d.id);
  });
});

describe('renameSim', () => {
  it('without the object answers unavailable and calls nothing', async () => {
    const { db, simId } = await setup();
    const out = await renameSim({
      db,
      stub: null,
      simId,
      actor: ACTOR,
      name: 'After',
      stamp: STAMP
    });
    expect(out).toEqual({ ok: false, code: 'unavailable' });
  });

  it('answers gone when the sim has no index row, without calling the object', async () => {
    const { db } = await setup();
    const { stub, appendAs } = stubAnswering(accepted);
    const out = await renameSim({
      db,
      stub,
      simId: 'no-such-sim',
      actor: ACTOR,
      name: 'After',
      stamp: STAMP
    });
    expect(out).toEqual({ ok: false, code: 'gone' });
    expect(appendAs).not.toHaveBeenCalled();
  });

  it('appends the name commit as the actor, with the start the object needs on an empty log', async () => {
    const { db, simId } = await setup();
    const { stub, appendAs } = stubAnswering(accepted);
    const out = await renameSim({ db, stub, simId, actor: ACTOR, name: 'After', stamp: STAMP });
    expect(out).toEqual({ ok: true });
    expect(appendAs).toHaveBeenCalledTimes(1);
    const input = appendAs.mock.calls[0][0];
    expect(input.actor).toBe(ACTOR);
    expect(input.draft).toEqual({ ...renameDraft('After', STAMP.build), id: input.draft.id });
    expect(input.draft).not.toHaveProperty('parent');
    expect(input.draft).not.toHaveProperty('datasetVersion');
    expect(input.start).toEqual({
      id: expect.any(String),
      title: headerTitle('  Garden  '),
      datasetVersion: STAMP.datasetVersion,
      build: STAMP.build
    });
    expect(input.start.title).toBe('Garden');
    expect(input.start.id).not.toBe(input.draft.id);
    expect(Object.keys(input).sort()).toEqual(['actor', 'draft', 'start']);
  });

  it.each(['limit', 'full', 'gone'] as const)('a %s refusal keeps its code', async (why) => {
    const { db, simId } = await setup();
    const { error } = mockConsole('error');
    const { stub } = stubAnswering(async () => ({ kind: 'refused', why }));
    const out = await renameSim({ db, stub, simId, actor: ACTOR, name: 'After', stamp: STAMP });
    expect(out).toEqual({ ok: false, code: why });
    expect(error).not.toHaveBeenCalled();
  });

  it.each(['invalid', 'newer', 'not-writer', 'behind'] as RefusedWhy[])(
    'a %s refusal is the generic failure, logged with the sim id and the reason only',
    async (why) => {
      const { db, simId } = await setup();
      const { error } = mockConsole('error');
      const { stub } = stubAnswering(async () => ({ kind: 'refused', why }));
      const out = await renameSim({ db, stub, simId, actor: ACTOR, name: 'After', stamp: STAMP });
      expect(out).toEqual({ ok: false, code: 'failed' });
      expect(error.mock.calls).toEqual([['[rename] refused', simId, why]]);
    }
  );

  it('a duplicate is the generic failure, logged as such', async () => {
    const { db, simId } = await setup();
    const { error } = mockConsole('error');
    const { stub } = stubAnswering(async () => ({ kind: 'duplicate' }));
    const out = await renameSim({ db, stub, simId, actor: ACTOR, name: 'After', stamp: STAMP });
    expect(out).toEqual({ ok: false, code: 'failed' });
    expect(error.mock.calls).toEqual([['[rename] refused', simId, 'duplicate']]);
  });

  it('a throw is the generic failure, logged with loggable only: no name, no actor', async () => {
    const { db, simId } = await setup();
    const { error } = mockConsole('error');
    const thrown = new DrizzleQueryError(`update sim_index set title = 'After' -- ${ACTOR}`, [
      'After',
      ACTOR
    ]);
    const { stub } = stubAnswering(async () => {
      throw thrown;
    });
    const out = await renameSim({ db, stub, simId, actor: ACTOR, name: 'After', stamp: STAMP });
    expect(out).toEqual({ ok: false, code: 'failed' });
    expect(error.mock.calls).toEqual([['[rename] failed', simId, loggable(thrown)]]);
    expect(loggable(thrown)).toBe(QUERY_FAILED);
    expect(loggable(thrown)).not.toContain(ACTOR);
  });
});
