// Saved games on the account: the first won save makes the account, a second device signed into
// it gets the save, and two devices that changed the same save both keep their version.
import { expect, test, type Browser, type Page, type Response } from '@playwright/test';
import { ACCOUNT_COPY, emailSentTo } from '../src/lib/account/account-copy';
import { SAVES_KEY, saveKey } from '../src/lib/game/saves';
import { gotoAccount } from './helpers/account';
import { loginAs, uniqueEmail } from './helpers/auth';
import { newVisitor, seedGame } from './helpers/game';

test.use({ storageState: { cookies: [], origins: [] } });

const GAME = '/api/game';

const pathOf = (r: Response): string => new URL(r.url()).pathname;
const isList = (r: Response): boolean => r.request().method() === 'GET' && pathOf(r) === GAME;
const isPut =
  (ok: (id: string) => boolean) =>
  (r: Response): boolean =>
    r.request().method() === 'PUT' &&
    pathOf(r).startsWith(`${GAME}/`) &&
    ok(decodeURIComponent(pathOf(r).slice(GAME.length + 1)));
const idOf = (r: Response): string => decodeURIComponent(pathOf(r).slice(GAME.length + 1));

type Entry = { id: string; name: string; savedAt: string };
type Listed = {
  handle: string;
  handleClaimed: boolean;
  saves: (Entry & { rev: number })[];
  removed: string[];
};

/** The saved games this browser holds, as `SAVES_KEY` lists them. */
function savesOf(page: Page): Promise<{ current: string; saves: Entry[] }> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), SAVES_KEY);
}

/** What `GET /api/game` answers in the page's context. */
async function listOf(page: Page): Promise<Listed> {
  const res = await page.request.get(GAME);
  expect(res.status()).toBe(200);
  return (await res.json()) as Listed;
}

/** Changes the stored game `id` as an edit would: a new name and a new `savedAt`. */
async function rename(page: Page, id: string, name: string): Promise<void> {
  await page.evaluate(
    (k) => {
      const savedAt = new Date().toISOString();
      const save = JSON.parse(localStorage.getItem(k.key) ?? 'null');
      localStorage.setItem(k.key, JSON.stringify({ ...save, name: k.name, savedAt }));
      const index = JSON.parse(localStorage.getItem(k.saves) ?? 'null');
      for (const e of index.saves) {
        if (e.id === k.id) Object.assign(e, { name: k.name, nameIsDefault: false, savedAt });
      }
      localStorage.setItem(k.saves, JSON.stringify(index));
    },
    { key: saveKey(id), saves: SAVES_KEY, id, name }
  );
}

/** A won game at level 2 on a new device; answers its id once its PUT made the account. */
async function firstSave(page: Page): Promise<string> {
  await seedGame(page, 2);
  const put = page.waitForResponse(isPut(() => true));
  await page.goto('/');
  const res = await put;
  expect(res.status()).toBe(200);
  return idOf(res);
}

/** Adds an email to the page's account through the dev link; answers the email. */
async function addEmail(page: Page): Promise<string> {
  await gotoAccount(page);
  const email = uniqueEmail('e2e-game-save');
  await page.getByLabel(ACCOUNT_COPY.emailLabel, { exact: true }).fill(email);
  await page.getByRole('button', { name: ACCOUNT_COPY.sendLink }).click();
  await expect(page.getByTestId('email-status')).toHaveText(emailSentTo(email));
  // The link lands on '/', whose sync pulls once it attaches.
  const pulled = page.waitForResponse(isList);
  await page.getByTestId('dev-link').click();
  expect((await pulled).status()).toBe(200);
  return email;
}

/** A second device signed into the page's account: it gets `id` and sends its own new game. */
async function secondDevice(
  browser: Browser,
  email: string,
  id: string
): Promise<{ page: Page; own: string; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await newVisitor(page);
  await loginAs(page, email);
  const got = page.waitForResponse(
    (r) => r.request().method() === 'GET' && pathOf(r) === `${GAME}/${id}`
  );
  const sent = page.waitForResponse(isPut((other) => other !== id));
  await page.goto('/');
  expect((await got).status()).toBe(200);
  const res = await sent;
  expect(res.status()).toBe(200);
  const own = idOf(res);
  await expect
    .poll(async () => (await savesOf(page)).saves.map((s) => s.id).sort())
    .toEqual([id, own].sort());
  return { page, own, close: () => context.close() };
}

test('the first save makes the account', async ({ page, context }) => {
  const id = await firstSave(page);
  expect((await savesOf(page)).current).toBe(id);
  expect((await context.cookies()).map((c) => c.name)).toContain('better-auth.session_token');

  const list = await listOf(page);
  expect(list.saves.map((s) => ({ id: s.id, rev: s.rev }))).toEqual([{ id, rev: 1 }]);
  expect(list.handleClaimed).toBe(false);
  expect(list.removed).toEqual([]);
});

test('a second device signed into the account gets the saved game', async ({ page, browser }) => {
  const id = await firstSave(page);
  const email = await addEmail(page);
  const second = await secondDevice(browser, email, id);
  try {
    const held = await savesOf(second.page);
    expect(held.current).toBe(second.own);
    expect(held.saves.find((s) => s.id === id)?.name).toBe('Seeded game');
  } finally {
    await second.close();
  }
});

test('a conflict keeps both versions', async ({ page, browser }) => {
  const id = await firstSave(page);
  const email = await addEmail(page);
  const second = await secondDevice(browser, email, id);
  try {
    // The first device changes it: rev 1 to rev 2.
    await rename(page, id, 'Alpha');
    const stored = page.waitForResponse(isPut((x) => x === id));
    await page.reload();
    const first = await stored;
    expect(first.status()).toBe(200);
    expect(((await first.json()) as { rev: number }).rev).toBe(2);

    // The second changes its rev 1 too: the account refuses it and both are kept.
    const b = second.page;
    await rename(b, id, 'Beta');
    const refused = b.waitForResponse(isPut((x) => x === id));
    const copied = b.waitForResponse(isPut((x) => x !== id && x !== second.own));
    await b.reload();
    expect((await refused).status()).toBe(409);
    expect((await copied).status()).toBe(200);

    await expect
      .poll(async () => (await savesOf(b)).saves.map((s) => s.name).sort())
      .toEqual(expect.arrayContaining(['Alpha', 'Beta (this device)']));
    const names = (await listOf(b)).saves.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['Alpha', 'Beta (this device)']));
  } finally {
    await second.close();
  }
});
