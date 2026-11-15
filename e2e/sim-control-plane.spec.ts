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
//
// A rename is a name commit the Worker appends through the object's appendAs RPC, which Node
// cannot run: these tests are its only test, on a sim with commits and on one with none.
import { expect, test } from '@playwright/test';
import { newId } from '../src/lib/ids/base58';
import { MEMBERS_COPY, SIMS_COPY } from '../src/lib/members/copy';
import { expectNoA11yViolations } from './helpers/a11y';
import { loginAs, sessionOf, uniqueEmail } from './helpers/auth';
import {
  freshContext,
  inviteLinkFor,
  inviteViaApi,
  openMembers,
  ownHandle,
  signInAndCreateSim
} from './helpers/members';
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

  // Four registrations of one new id at once, two from each account: the batch's grant gated on
  // its own insert is what keeps a losing call from granting anything, on the real Worker.
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
      const accounts = [page, other];
      // Which account each of the four calls comes from.
      const from = [0, 1, 0, 1];
      const responses = await Promise.all(
        from.map((a) => accounts[a].request.post('/api/sims', { data: { simId, title: 'Race' } }))
      );
      const statuses = responses.map((r) => r.status());
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      const won = from[statuses.indexOf(201)];
      const byAccount = [0, 1].map((a) =>
        statuses.filter((_, i) => from[i] === a).sort((x, y) => x - y)
      );
      // The winner's repeat is the no-op; both of the other account's calls are refused.
      expect(byAccount[won]).toEqual([200, 201]);
      expect(byAccount[1 - won]).toEqual([409, 409]);
      const refusals = responses.filter((r) => r.status() === 409);
      expect(await Promise.all(refusals.map((r) => r.json()))).toEqual([
        { error: SIMS_COPY.notYours, code: 'taken' },
        { error: SIMS_COPY.notYours, code: 'taken' }
      ]);
      const winner = accounts[won];
      const loser = accounts[1 - won];

      // Exactly one member: the winner, as manager.
      await openMembers(winner, simId);
      const handle = await ownHandle(winner);
      const rows = winner.getByTestId('members').getByRole('list').first().getByRole('listitem');
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(`@${handle}`);
      await expect(rows.first()).toContainText('· manager');

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
    // A second sim of the same manager, which the takedown must leave alone.
    const bystander = newId();
    expect(
      (
        await page.request.post('/api/sims', { data: { simId: bystander, title: 'Bystander' } })
      ).status()
    ).toBe(201);
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

    // The other sim still opens, and its manager still writes it.
    await page.goto('/about');
    const b = await openSimSocket(page, bystander);
    expect((await framesAtLeast(page, b, 2))[1]).toEqual({ type: 'access', write: true });
    const tip = commitsOf(await resumeAndRead(page, b, 0)).length;
    const d = nameDraft(tip, 'Still here');
    expect(commitsOf(await sendAndRead(page, b, { type: 'append', commit: d }))).toMatchObject([
      { id: d.id }
    ]);
  });
});

test.describe('a rename is a name commit', () => {
  test("a rename on the member page reaches another member's open socket", async ({
    page,
    browser,
    baseURL
  }, testInfo) => {
    const managerEmail = uniqueEmail('cp-rename');
    const { userId: managerId } = await loginAs(page, managerEmail);
    const simId = await signInAndCreateSim(page, managerEmail, 'Before');
    const memberEmail = uniqueEmail('cp-renamed');
    await inviteViaApi(page, simId, memberEmail);
    const link = await inviteLinkFor(page, memberEmail);
    // The manager's socket opens first, so the log has its start commit before the rename.
    await page.goto('/about');
    const m = await openSimSocket(page, simId);
    await framesAtLeast(page, m, 2);
    expect(commitsOf(await resumeAndRead(page, m, 0))).toHaveLength(1);

    const ctx = await freshContext(browser, testInfo);
    try {
      const member = await ctx.newPage();
      await loginAs(member, memberEmail);
      await member.goto(link);
      await member.getByRole('button', { name: MEMBERS_COPY.inviteAccept }).click();
      await member.waitForURL(new RegExp(`/sims/${simId}$`));
      // An editor gets the control too.
      await expect(member.getByTestId('rename')).toHaveCount(1);
      await member.goto('/about');
      const h = await openSimSocket(member, simId);
      await framesAtLeast(member, h, 2);
      expect(commitsOf(await resumeAndRead(member, h, 0))).toHaveLength(1);
      const seen = (await framesAtLeast(member, h, 0)).length;

      const renamer = await page.context().newPage();
      await renamer.goto(`/sims/${simId}`);
      await expect(renamer.locator('html')).toHaveAttribute('data-hydrated', '');
      const disclosure = renamer.getByTestId('rename');
      await disclosure.locator('summary').click();
      const field = renamer.getByLabel(SIMS_COPY.renameLabel, { exact: true });
      const save = renamer.getByRole('button', { name: SIMS_COPY.renameSave });
      await expect(field).toHaveValue('Before');
      await expectNoA11yViolations(renamer);
      await field.fill('After');
      await save.click();
      await expect(renamer.getByRole('heading', { level: 1 })).toHaveText('After');
      // The accepted rename closes the disclosure the person opened.
      await expect(disclosure).not.toHaveAttribute('open');

      const [named] = commitsOf((await framesAtLeast(member, h, seen + 1))[seen]);
      expect(named).toMatchObject({
        seq: 2,
        parent: 1,
        actor: managerId,
        source: 'sim.name',
        datasetVersion: 'fixture-0',
        changes: [{ op: 'set', key: 'sim', field: 'name', value: 'After' }]
      });

      // A refused name: the line asks for a name, the field keeps what was sent, and Save stays
      // in line with the field.
      await disclosure.locator('summary').click();
      await field.fill('   ');
      await save.click();
      await expect(renamer.getByTestId('sim-name-error')).toHaveText(SIMS_COPY.nameRequired);
      await expect(field).toHaveValue('   ');
      const [f, b] = [await field.boundingBox(), await save.boundingBox()];
      expect(Math.abs(b!.y + b!.height / 2 - (f!.y + f!.height / 2))).toBeLessThan(1);
      await expectNoA11yViolations(renamer);

      // The same name again: accepted, and no commit is appended (the log is checked below).
      await field.fill('After');
      await save.click();
      await expect(renamer.getByTestId('sim-name-error')).toHaveCount(0);
      await expect(disclosure).not.toHaveAttribute('open');

      await renamer.goto('/sims');
      await expect(renamer.locator(`a[href="/sims/${simId}"]`)).toHaveText('After');
    } finally {
      await ctx.close();
    }

    // A signed-in reader who is not a member: no member page, and a direct post is refused.
    // No product path makes a viewer; the viewer's 403 is in the action's Node spec.
    const octx = await freshContext(browser, testInfo);
    try {
      const reader = await octx.newPage();
      await loginAs(reader, uniqueEmail('cp-reader'));
      expect((await reader.goto(`/sims/${simId}`))?.status()).toBe(404);
      const refused = await reader.request.post(`/sims/${simId}?/rename`, {
        headers: { origin: baseURL!, 'x-sveltekit-action': 'true' },
        form: { name: 'Hijacked' }
      });
      expect(refused.status()).toBe(404);
      expect((await refused.json()).type).toBe('error');
    } finally {
      await octx.close();
    }
    expect(commitsOf(await resumeAndRead(page, m, 0)).map((c) => c.source)).toEqual([
      'sim.start',
      'sim.name'
    ]);
  });

  test('renaming a sim with no commits records its start commit first', async ({
    page,
    baseURL
  }) => {
    const email = uniqueEmail('cp-fresh');
    const { userId } = await loginAs(page, email);
    const simId = await signInAndCreateSim(page, email, 'Original');
    const res = await page.request.post(`/sims/${simId}?/rename`, {
      headers: { origin: baseURL!, 'x-sveltekit-action': 'true' },
      form: { name: 'Renamed' }
    });
    expect(await res.json()).toEqual({
      type: 'redirect',
      status: 303,
      location: `/sims/${simId}`
    });
    await page.goto(`/sims/${simId}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Renamed');

    await page.goto('/about');
    const h = await openSimSocket(page, simId);
    await framesAtLeast(page, h, 2);
    expect(
      commitsOf(await resumeAndRead(page, h, 0)).map((c) => [
        c.seq,
        c.parent,
        c.actor,
        c.source,
        c.changes
      ])
    ).toEqual([
      [1, 0, userId, 'sim.start', [{ op: 'set', key: 'sim', field: 'name', value: 'Original' }]],
      [2, 1, userId, 'sim.name', [{ op: 'set', key: 'sim', field: 'name', value: 'Renamed' }]]
    ]);
  });
});
