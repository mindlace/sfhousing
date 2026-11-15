// Roster changes reaching the sim object's open sockets, end to end against wrangler dev: the
// roster hook calls the object's rereadRoles() after an invitation is accepted, a member is
// removed or the last member leaves. Each test makes its own accounts and sim.
//
// When the last member leaves, the sim is kept with no members: its link still opens
// read-only. The design says an edit there starts a remix; remix is a later unit, so here the
// former member's append is refused `not-writer`.
//
// The operator takedown: the route clears the object (open sockets close with 4410 `gone`),
// deletes the D1 rows and bars the id. The preview server gets an obviously fake token.
import { expect, test } from '@playwright/test';
import { newId } from '../src/lib/ids/base58';
import { MEMBERS_COPY, SIMS_COPY } from '../src/lib/members/copy';
import { loginAs, sessionOf, uniqueEmail } from './helpers/auth';
import { freshContext, inviteLinkFor, inviteViaApi, signInAndCreateSim } from './helpers/members';
import {
  closedCode,
  commitsOf,
  framesAtLeast,
  nameDraft,
  openSimSocket,
  resumeAndRead,
  sendAndRead
} from './helpers/sim-socket';

test.describe('roster changes reach open sockets', () => {
  test('an invited member gains write on an open socket, and loses it when removed', async ({
    page,
    browser
  }, testInfo) => {
    const simId = await signInAndCreateSim(page, uniqueEmail('cp-manager'), 'Roster');
    const memberEmail = uniqueEmail('cp-member');
    await inviteViaApi(page, simId, memberEmail);
    const link = await inviteLinkFor(page, memberEmail);
    // The manager's own socket, to show the removal leaves it alone.
    await page.goto('/about');
    const m = await openSimSocket(page, simId);
    expect((await framesAtLeast(page, m, 2))[1]).toEqual({ type: 'access', write: true });
    await resumeAndRead(page, m, 0);

    const ctx = await freshContext(browser, testInfo);
    try {
      const member = await ctx.newPage();
      const { userId } = await loginAs(member, memberEmail);
      await member.goto('/about');
      const h = await openSimSocket(member, simId);
      expect((await framesAtLeast(member, h, 2))[1]).toEqual({ type: 'access', write: false });

      const join = await ctx.newPage();
      await join.goto(link);
      await join.getByRole('button', { name: MEMBERS_COPY.inviteAccept }).click();
      await join.waitForURL(new RegExp(`/sims/${simId}$`));
      expect((await framesAtLeast(member, h, 3))[2]).toEqual({ type: 'access', write: true });

      const tip = commitsOf(await resumeAndRead(member, h, 0)).length;
      const ok = nameDraft(tip, 'Member edit');
      expect(commitsOf(await sendAndRead(member, h, { type: 'append', commit: ok }))).toMatchObject(
        [{ id: ok.id }]
      );
      // The manager's socket: hello, access, its resume answer, then the member's commit.
      expect(commitsOf((await framesAtLeast(page, m, 4))[3])).toMatchObject([{ id: ok.id }]);

      const before = (await framesAtLeast(member, h, 0)).length;
      const removed = await page.request.delete(`/api/sims/${simId}/members/${userId}`, {
        headers: { 'content-type': 'application/json' }
      });
      expect(removed.status()).toBe(204);
      expect((await framesAtLeast(member, h, before + 1))[before]).toEqual({
        type: 'access',
        write: false
      });
      const late = nameDraft(tip + 1, 'Too late');
      expect(await sendAndRead(member, h, { type: 'append', commit: late })).toEqual({
        type: 'refused',
        id: late.id,
        why: 'not-writer'
      });

      // The manager still writes: the next frame its socket gets after its own append is
      // that append's commit, never an `access` change.
      const own = nameDraft(tip + 1, 'Manager edit');
      expect(commitsOf(await sendAndRead(page, m, { type: 'append', commit: own }))).toMatchObject([
        { id: own.id }
      ]);
      expect((await framesAtLeast(page, m, 0)).filter((f) => f.type === 'access')).toEqual([
        { type: 'access', write: true }
      ]);
    } finally {
      await ctx.close();
    }
  });

  test('the last member leaves: open sockets lose write, and the link still opens', async ({
    page,
    browser,
    baseURL
  }, testInfo) => {
    const simId = await signInAndCreateSim(page, uniqueEmail('cp-last'), 'Kept');
    // A second sim the leaver keeps, so their list has something to render.
    const otherId = newId();
    const other = await page.request.post('/api/sims', {
      data: { simId: otherId, title: 'Still mine' }
    });
    expect(other.status()).toBe(201);
    await page.goto('/about');
    const h = await openSimSocket(page, simId);
    await framesAtLeast(page, h, 2);
    const [start] = commitsOf(await resumeAndRead(page, h, 0));
    const before = (await framesAtLeast(page, h, 0)).length;
    const left = await page.request.post(`/sims/${simId}?/leaveSim`, {
      headers: { origin: baseURL!, 'x-sveltekit-action': 'true' },
      form: {}
    });
    expect(left.ok()).toBe(true);
    expect((await framesAtLeast(page, h, before + 1))[before]).toEqual({
      type: 'access',
      write: false
    });
    // Not a remix (a later unit): the append is refused.
    const d = nameDraft(1, 'After');
    expect(await sendAndRead(page, h, { type: 'append', commit: d })).toEqual({
      type: 'refused',
      id: d.id,
      why: 'not-writer'
    });

    // The leaver's list no longer has it: once the list shows the sim they kept, the left one
    // is absent.
    await page.goto('/sims');
    await expect(page.locator(`a[href="/sims/${otherId}"]`)).toBeVisible();
    await expect(page.locator(`a[href="/sims/${simId}"]`)).toHaveCount(0);

    // Knowing the id does not make the former manager its manager again.
    const again = await page.request.post('/api/sims', { data: { simId, title: 'Kept' } });
    expect(again.status()).toBe(409);
    expect(await again.json()).toEqual({ error: SIMS_COPY.notYours, code: 'taken' });

    const ctx = await freshContext(browser, testInfo);
    try {
      const visitor = await ctx.newPage();
      await visitor.goto('/about');
      const v = await openSimSocket(visitor, simId);
      expect((await framesAtLeast(visitor, v, 2))[1]).toEqual({ type: 'access', write: false });
      expect(commitsOf(await resumeAndRead(visitor, v, 0)).map((c) => c.id)).toEqual([start.id]);
    } finally {
      await ctx.close();
    }
  });
});

test.describe('registration', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a fresh visitor registers an id: one account, then a no-op', async ({ page }) => {
    const simId = newId();
    const first = await page.request.post('/api/sims', { data: { simId } });
    expect(first.status()).toBe(201);
    expect(await first.json()).toEqual({ simId, created: true });
    const minted = await sessionOf(page);
    expect(minted?.user?.isAnonymous).toBe(true);
    const again = await page.request.post('/api/sims', { data: { simId } });
    expect(again.status()).toBe(200);
    expect(await again.json()).toEqual({ simId, created: false });
    expect((await sessionOf(page))?.user?.id).toBe(minted?.user?.id);
    await page.goto('/about');
    const h = await openSimSocket(page, simId);
    expect((await framesAtLeast(page, h, 2))[1]).toEqual({ type: 'access', write: true });
    expect(commitsOf(await resumeAndRead(page, h, 0))[0].changes).toEqual([
      { op: 'set', key: 'sim', field: 'name', value: 'Untitled sim' }
    ]);
  });

  test('another account registering the id is refused, and stays a reader', async ({
    page,
    browser
  }, testInfo) => {
    const simId = await signInAndCreateSim(page, uniqueEmail('cp-owner'), 'Owned');
    const ctx = await freshContext(browser, testInfo);
    try {
      const other = await ctx.newPage();
      await loginAs(other, uniqueEmail('cp-other'));
      const res = await other.request.post('/api/sims', { data: { simId } });
      expect(res.status()).toBe(409);
      expect(await res.json()).toEqual({ error: SIMS_COPY.notYours, code: 'taken' });
      await other.goto('/about');
      const h = await openSimSocket(other, simId);
      expect((await framesAtLeast(other, h, 2))[1]).toEqual({ type: 'access', write: false });
    } finally {
      await ctx.close();
    }
  });

  test('two accounts registering one new id at once: one manager, the other a reader', async ({
    page,
    browser
  }, testInfo) => {
    await loginAs(page, uniqueEmail('cp-race-a'));
    const ctx = await freshContext(browser, testInfo);
    try {
      const other = await ctx.newPage();
      await loginAs(other, uniqueEmail('cp-race-b'));
      const simId = newId();
      const pages = [page, other];
      const statuses = (
        await Promise.all(
          pages.map((p) => p.request.post('/api/sims', { data: { simId, title: 'Race' } }))
        )
      ).map((r) => r.status());
      expect([...statuses].sort()).toEqual([201, 409]);
      const winner = pages[statuses.indexOf(201)];
      const loser = pages[statuses.indexOf(409)];
      await winner.goto('/about');
      await loser.goto('/about');
      const w = await openSimSocket(winner, simId);
      expect((await framesAtLeast(winner, w, 2))[1]).toEqual({ type: 'access', write: true });
      const l = await openSimSocket(loser, simId);
      expect((await framesAtLeast(loser, l, 2))[1]).toEqual({ type: 'access', write: false });
    } finally {
      await ctx.close();
    }
  });

  test('one account registering one new id twice at once: one 201, one 200', async ({ page }) => {
    await loginAs(page, uniqueEmail('cp-twice'));
    const simId = newId();
    const results = await Promise.all([
      page.request.post('/api/sims', { data: { simId } }),
      page.request.post('/api/sims', { data: { simId } })
    ]);
    expect(results.map((r) => r.status()).sort()).toEqual([200, 201]);
    await page.goto('/about');
    const h = await openSimSocket(page, simId);
    expect((await framesAtLeast(page, h, 2))[1]).toEqual({ type: 'access', write: true });
  });

  test('a known device with no session gets 401 and no account', async ({
    page,
    context,
    baseURL
  }) => {
    await context.addCookies([{ name: 'sfh_known', value: '1', url: baseURL! }]);
    const res = await page.request.post('/api/sims', { data: { simId: newId() } });
    expect(res.status()).toBe(401);
    expect((await res.json()).code).toBe('sign_in');
    expect(await sessionOf(page)).toBeNull();
  });
});

test.describe('a fuse tells the absorbed identity sims', () => {
  test("after a fuse the survivor writes the absorbed identity's sim, on an open socket", async ({
    page,
    browser,
    baseURL
  }, testInfo) => {
    const survivorEmail = uniqueEmail('cp-survivor');
    const sctx = await freshContext(browser, testInfo);
    try {
      const survivor = await sctx.newPage();
      await loginAs(survivor, survivorEmail);
      // The first registration mints the pseudonymous account that will be absorbed.
      const simId = newId();
      expect(
        (await page.request.post('/api/sims', { data: { simId, title: 'Fused' } })).status()
      ).toBe(201);
      await survivor.goto('/about');
      const h = await openSimSocket(survivor, simId);
      expect((await framesAtLeast(survivor, h, 2))[1]).toEqual({ type: 'access', write: false });

      // Signing in with the survivor's address fuses the pseudonymous identity into it.
      const res = await page.request.post('/signin?/sendLink', {
        headers: { origin: baseURL!, 'x-sveltekit-action': 'true' },
        form: { identifier: survivorEmail }
      });
      const body = (await res.json()) as { data: string };
      const link = /https?:[^"\\]*magic-link\/verify[^"\\]*/.exec(body.data)?.[0];
      expect(link, 'dev link in the action data').toBeTruthy();
      await page.goto(link!);

      expect((await framesAtLeast(survivor, h, 3))[2]).toEqual({ type: 'access', write: true });
      const tip = commitsOf(await resumeAndRead(survivor, h, 0)).length;
      const d = nameDraft(tip, 'Survivor edit');
      expect(
        commitsOf(await sendAndRead(survivor, h, { type: 'append', commit: d }))
      ).toMatchObject([{ id: d.id }]);
    } finally {
      await sctx.close();
    }
  });
});

test.describe('the operator takedown', () => {
  /** The preview server's --var in playwright.config.ts: fake, test-only. */
  const TAKEDOWN_TOKEN = 'e2e-takedown-token-00000000000000000000';

  test('a refused token changes nothing; a takedown closes sockets with gone, for good', async ({
    page
  }) => {
    const simId = await signInAndCreateSim(page, uniqueEmail('cp-taken'), 'Doomed');
    const takedown = (authorization?: string) =>
      page.request.post(`/api/operator/sims/${simId}/takedown`, {
        headers: {
          'content-type': 'application/json',
          ...(authorization ? { authorization } : {})
        },
        data: {}
      });

    // A wrong token and no token: 404, and the sim still opens for its writer.
    for (const refused of [await takedown('Bearer wrong'), await takedown()]) {
      expect(refused.status()).toBe(404);
      expect(await refused.json()).toEqual({ error: 'Not found.' });
    }
    await page.goto('/about');
    const h = await openSimSocket(page, simId);
    expect((await framesAtLeast(page, h, 2))[1]).toEqual({ type: 'access', write: true });
    expect(commitsOf(await resumeAndRead(page, h, 0)).length).toBeGreaterThan(0);

    const res = await takedown(`Bearer ${TAKEDOWN_TOKEN}`);
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ simId });
    expect(await closedCode(page, h)).toBe(4410);

    // The stream route answers 404 once the index row is gone, so the upgrade fails.
    const again = await openSimSocket(page, simId);
    expect(await closedCode(page, again)).toBe(1006);
    const registered = await page.request.post('/api/sims', { data: { simId } });
    expect(registered.status()).toBe(409);
    expect(await registered.json()).toEqual({ error: SIMS_COPY.notYours, code: 'taken' });
    expect((await page.goto(`/sims/${simId}`))?.status()).toBe(404);
  });
});
