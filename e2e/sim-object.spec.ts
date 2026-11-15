// The sim object's websocket end to end, against wrangler dev: the route, the Durable Object and
// its storage. Each test makes its own sim (and its own accounts), so the tests run in parallel
// and in any order. A "no frame came" check sends a resume after it and reads the next frame:
// frames on one socket arrive in order, so anything the earlier frame caused would come first.
//
// Not here yet: a role change ending write on an open socket, and `gone` after a takedown. They
// need a caller of the object's rereadRoles() and takeDown(), which a later unit adds with its
// own end-to-end tests; the logic under them is tested in Node (access.spec.ts, log-host.spec.ts).
import { expect, test, type Page } from '@playwright/test';
import { newId } from '../src/lib/ids/base58';
import { loginAs, uniqueEmail } from './helpers/auth';
import { freshContext, signInAndCreateSim } from './helpers/members';
import {
  closedCode,
  commitsOf,
  framesAtLeast,
  nameDraft,
  openSimSocket,
  resumeAndRead,
  sendAndRead,
  sendFrame
} from './helpers/sim-socket';

/** Sign in, create a sim through the API, open a socket on it and resume from 0. */
async function writerOn(page: Page, title: string) {
  const simId = await signInAndCreateSim(page, uniqueEmail('sim-writer'), title);
  await page.goto('/about');
  const h = await openSimSocket(page, simId);
  await framesAtLeast(page, h, 2);
  const start = commitsOf(await resumeAndRead(page, h, 0));
  return { simId, h, start };
}

test.describe('sim object socket', () => {
  test('a writer opening a new sim gets hello, access and the start commit', async ({ page }) => {
    const simId = await signInAndCreateSim(page, uniqueEmail('sim-writer'), 'Garden');
    await page.goto('/about');
    const h = await openSimSocket(page, simId);
    const [hello, access] = await framesAtLeast(page, h, 2);
    expect(hello).toEqual({ type: 'hello', build: expect.any(String), protocol: 1 });
    expect(access).toEqual({ type: 'access', write: true });
    const [start, ...rest] = commitsOf(await resumeAndRead(page, h, 0));
    expect(rest).toEqual([]);
    expect(start).toMatchObject({
      seq: 1,
      parent: 0,
      kind: 'system',
      source: 'sim.start',
      datasetVersion: 'fixture-0',
      changes: [{ op: 'set', key: 'sim', field: 'name', value: 'Garden' }]
    });
    expect(start.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('appends get gapless positions and every resumed socket sees one order', async ({
    page
  }) => {
    const { simId, h, start } = await writerOn(page, 'Order');
    const h2 = await openSimSocket(page, simId);
    await framesAtLeast(page, h2, 2);
    await resumeAndRead(page, h2, 1);
    const a = nameDraft(1, 'A');
    const onH = commitsOf(await sendAndRead(page, h, { type: 'append', commit: a }));
    const onH2 = commitsOf((await framesAtLeast(page, h2, 4))[3]);
    expect(onH).toEqual(onH2);
    expect(onH).toMatchObject([{ seq: 2, id: a.id, actor: expect.any(String) }]);
    const b = nameDraft(2, 'B');
    const fromH2 = commitsOf(await sendAndRead(page, h2, { type: 'append', commit: b }));
    expect(fromH2).toMatchObject([{ seq: 3, id: b.id }]);
    // h: hello, access, its resume answer, [a], [b]
    expect(commitsOf((await framesAtLeast(page, h, 5))[4])).toEqual(fromH2);
    expect(
      await sendAndRead(page, h, { type: 'append', commit: nameDraft(2, 'Late') })
    ).toMatchObject({
      type: 'refused',
      why: 'behind'
    });
    const h3 = await openSimSocket(page, simId);
    await framesAtLeast(page, h3, 2);
    expect(commitsOf(await resumeAndRead(page, h3, 0)).map((c) => c.id)).toEqual([
      start[0].id,
      a.id,
      b.id
    ]);
  });

  test('a stale parent is behind, and a duplicate id appends once', async ({ page }) => {
    const { h, start } = await writerOn(page, 'Dupes');
    const a = nameDraft(1, 'A');
    await sendAndRead(page, h, { type: 'append', commit: a });
    const stale = nameDraft(1, 'Stale');
    expect(await sendAndRead(page, h, { type: 'append', commit: stale })).toEqual({
      type: 'refused',
      id: stale.id,
      why: 'behind'
    });
    const before = (await framesAtLeast(page, h, 0)).length;
    await sendFrame(page, h, { type: 'append', commit: a });
    // Frames on one socket arrive in order: anything the duplicate caused would come first.
    expect(await resumeAndRead(page, h, 2)).toEqual({ type: 'commits', commits: [] });
    expect(await framesAtLeast(page, h, 0)).toHaveLength(before + 1);
    expect(commitsOf(await resumeAndRead(page, h, 0)).map((c) => c.id)).toEqual([
      start[0].id,
      a.id
    ]);
  });

  test('invalid, newer and oversized appends are refused and change nothing', async ({ page }) => {
    const { h, start } = await writerOn(page, 'Refusals');
    const bad = { ...nameDraft(1, 'X'), changes: [{ op: 'delete', key: 'p:nope' }] };
    expect(await sendAndRead(page, h, { type: 'append', commit: bad })).toEqual({
      type: 'refused',
      id: bad.id,
      why: 'invalid'
    });
    const newer = nameDraft(1, 'Later', { shapes: 2 });
    expect(await sendAndRead(page, h, { type: 'append', commit: newer })).toEqual({
      type: 'refused',
      id: newer.id,
      why: 'newer'
    });
    // The tip is still the start commit: nothing after position 1.
    expect(await resumeAndRead(page, h, 1)).toEqual({ type: 'commits', commits: [] });
    // Over the incoming frame limit: refused before it is parsed, so the commit is not named.
    const big = nameDraft(1, 'x'.repeat(1_100_000));
    expect(await sendAndRead(page, h, { type: 'append', commit: big })).toEqual({
      type: 'refused',
      id: null,
      why: 'limit'
    });
    expect(commitsOf(await resumeAndRead(page, h, 0)).map((c) => c.id)).toEqual([start[0].id]);
  });

  test('a non-member and a signed-out visitor read but cannot write', async ({
    page,
    browser
  }, testInfo) => {
    const { simId } = await writerOn(page, 'Shared');
    const other = await freshContext(browser, testInfo);
    const visitor = await freshContext(browser, testInfo);
    try {
      const reader = await other.newPage();
      await loginAs(reader, uniqueEmail('sim-reader'));
      const anon = await visitor.newPage();
      for (const p of [reader, anon]) {
        await p.goto('/about');
        const h = await openSimSocket(p, simId);
        expect((await framesAtLeast(p, h, 2))[1]).toEqual({ type: 'access', write: false });
        expect(commitsOf(await resumeAndRead(p, h, 0))).toHaveLength(1);
        const d = nameDraft(1, 'Mine');
        expect(await sendAndRead(p, h, { type: 'append', commit: d })).toEqual({
          type: 'refused',
          id: d.id,
          why: 'not-writer'
        });
      }
    } finally {
      await other.close();
      await visitor.close();
    }
  });

  test('resume answers from any position', async ({ page }) => {
    const { h } = await writerOn(page, 'Resume');
    await sendAndRead(page, h, { type: 'append', commit: nameDraft(1, 'A') });
    await sendAndRead(page, h, { type: 'append', commit: nameDraft(2, 'B') });
    expect(commitsOf(await resumeAndRead(page, h, 2)).map((c) => c.seq)).toEqual([3]);
    expect(commitsOf(await resumeAndRead(page, h, 3))).toEqual([]);
    expect(await resumeAndRead(page, h, 9)).toEqual({ type: 'refused', id: null, why: 'gone' });
  });

  test('a sim with no index row is refused before the upgrade', async ({ page }) => {
    await page.goto('/about');
    const h = await openSimSocket(page, newId());
    expect(await closedCode(page, h)).toBe(1006);
    expect(await framesAtLeast(page, h, 0)).toEqual([]);
    expect((await page.request.get(`/api/sims/${newId()}/stream`)).status()).toBe(426);
  });
});
