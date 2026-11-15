// Roster changes reaching the sim object's open sockets, end to end against wrangler dev: the
// roster hook calls the object's rereadRoles() after an invitation is accepted, a member is
// removed or the last member leaves. Each test makes its own accounts and sim.
//
// When the last member leaves, the sim is kept with no members: its link still opens
// read-only. The design says an edit there starts a remix; remix is a later unit, so here the
// former member's append is refused `not-writer`.
import { expect, test } from '@playwright/test';
import { newId } from '../src/lib/ids/base58';
import { MEMBERS_COPY, SIMS_COPY } from '../src/lib/members/copy';
import { loginAs, sessionOf, uniqueEmail } from './helpers/auth';
import { freshContext, inviteLinkFor, inviteViaApi, signInAndCreateSim } from './helpers/members';
import {
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
