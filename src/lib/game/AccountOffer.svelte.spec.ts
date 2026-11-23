/// <reference types="@vitest/browser-playwright" />
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { cdp, page, userEvent } from 'vitest/browser';
import axe from 'axe-core';
import '../../routes/layout.css';
import { currentUser } from '$lib/account/current-user.svelte';
import { syncText } from './copy';
import AccountOffer from './AccountOffer.svelte';
import { FakeSync } from './test/fake-sync.svelte';

type StubUser = {
  id: string;
  handle: string;
  name: string | null;
  pseudonymous: boolean;
} | null;

const hoisted = vi.hoisted(() => ({
  pageStub: {
    data: { user: null } as { user: unknown },
    url: new URL('http://localhost/game/2?x=1')
  },
  holder: { sync: null as unknown, open: false }
}));

vi.mock('$app/state', () => ({ page: hoisted.pageStub }));
vi.mock('./store.svelte', () => ({
  useGame: () => ({ sync: hoisted.holder.sync, open: hoisted.holder.open })
}));

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

async function scheme(value: 'light' | 'dark') {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value }]
  });
}

let sync: FakeSync;
let fetchSpy: MockInstance<typeof fetch>;

function setUser(user: StubUser) {
  hoisted.pageStub.data.user = user;
}

const USER: NonNullable<StubUser> = {
  id: 'u1',
  handle: 'quiet-fox-12',
  name: null,
  pseudonymous: true
};

function reply(status: number, body: unknown) {
  fetchSpy.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' }
    })
  );
}

const field = () => page.getByLabelText('Save as');
const save = () => page.getByRole('button', { name: 'Save' });

beforeEach(() => {
  sync = new FakeSync();
  hoisted.holder.sync = sync;
  hoisted.holder.open = false;
  setUser(null);
  fetchSpy = vi.spyOn(globalThis, 'fetch');
});

afterEach(async () => {
  await scheme('light');
  fetchSpy.mockRestore();
  currentUser.apply('reset', {});
  setUser(null);
});

describe('AccountOffer states', () => {
  it('sign-in: a link to /signin with the current path', async () => {
    sync.state = 'sign-in';
    await render(AccountOffer);
    const link = page.getByRole('link', { name: syncText('sign-in')! });
    await expect.element(link).toBeVisible();
    expect(link.element().getAttribute('href')).toBe(
      `/signin?returnTo=${encodeURIComponent('/game/2?x=1')}`
    );
  });

  it('no account: says this device only', async () => {
    const view = await render(AccountOffer);
    await expect.element(page.getByText(syncText('local')!)).toBeVisible();
    expect(view.container.querySelector('input')).toBeNull();
    expect(view.container.querySelector('a')).toBeNull();
  });

  it('handle never chosen: Save as, a hidden @, the handle as placeholder, Save', async () => {
    sync.account = { handle: 'quiet-fox-12', handleClaimed: false };
    const view = await render(AccountOffer);
    await expect.element(field()).toBeVisible();
    expect(field().element().getAttribute('placeholder')).toBe('quiet-fox-12');
    expect(view.container.querySelector('[aria-hidden="true"]')?.textContent).toBe('@');
    await expect.element(save()).toBeVisible();
  });

  it('handle chosen without a user: @handle to /account and the email link', async () => {
    sync.account = { handle: 'bold-owl-7', handleClaimed: true };
    await render(AccountOffer);
    const link = page.getByRole('link', { name: '@bold-owl-7' });
    expect(link.element().getAttribute('href')).toBe('/account');
    const add = page.getByRole('link', { name: 'Add an email to play on another device' });
    expect(add.element().getAttribute('href')).toBe('/account');
  });

  it('a user with no account line is the chosen state; an email hides the add link', async () => {
    setUser({ ...USER, pseudonymous: false });
    await render(AccountOffer);
    await expect.element(page.getByRole('link', { name: '@quiet-fox-12' })).toBeVisible();
    await expect
      .element(page.getByRole('link', { name: 'Add an email to play on another device' }))
      .not.toBeInTheDocument();
  });

  it('a pseudonymous user keeps the add-email link', async () => {
    setUser(USER);
    await render(AccountOffer);
    await expect
      .element(page.getByRole('link', { name: 'Add an email to play on another device' }))
      .toBeVisible();
  });

  it('renders the no-account state when the page has no data', async () => {
    const stub = hoisted.pageStub as { data?: unknown };
    const data = stub.data;
    delete stub.data;
    try {
      await render(AccountOffer);
      await expect.element(page.getByText(syncText('local')!)).toBeVisible();
    } finally {
      stub.data = data;
    }
  });

  it('renders nothing under the open game', async () => {
    hoisted.holder.open = true;
    sync.account = { handle: 'a', handleClaimed: false };
    const view = await render(AccountOffer);
    expect(view.container.textContent).toBe('');
  });
});

describe('AccountOffer save', () => {
  beforeEach(() => {
    sync.account = { handle: 'quiet-fox-12', handleClaimed: false };
  });

  it('is disabled while empty and enabled once typed', async () => {
    await render(AccountOffer);
    await expect.element(save()).toBeDisabled();
    await userEvent.type(field(), '  ');
    await expect.element(save()).toBeDisabled();
    await userEvent.type(field(), 'ada');
    await expect.element(save()).toBeEnabled();
  });

  it('sends only the trimmed handle', async () => {
    reply(200, { success: true, handle: 'ada' });
    await render(AccountOffer);
    await userEvent.type(field(), '  ada  ');
    await save().click();
    await expect.element(page.getByRole('link', { name: '@ada' })).toBeVisible();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('/api/account/profile');
    expect(init?.method).toBe('PATCH');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual({ handle: 'ada' });
  });

  it('a 200 shows the link, announces Saved., pulls and updates the user overlay', async () => {
    setUser(USER);
    reply(200, { success: true, handle: 'ada', handleChanged: true });
    const view = await render(AccountOffer);
    await userEvent.type(field(), 'ada');
    await save().click();
    await expect.element(page.getByRole('link', { name: '@ada' })).toBeVisible();
    const live = view.container.querySelector('[aria-live="polite"]')!;
    await expect.poll(() => live.textContent).toBe('Saved.');
    expect(sync.calls.filter((c) => c.kind === 'pull')).toHaveLength(1);
    expect(currentUser.overlay(USER)?.handle).toBe('ada');
  });

  it('is aria-busy while in flight', async () => {
    let release!: (r: Response) => void;
    fetchSpy.mockReturnValueOnce(new Promise<Response>((res) => (release = res)));
    await render(AccountOffer);
    await userEvent.type(field(), 'ada');
    await save().click();
    await expect.element(save()).toHaveAttribute('aria-busy', 'true');
    await expect.element(save()).toBeDisabled();
    release(new Response(JSON.stringify({ handle: 'ada' }), { status: 200 }));
    await expect.element(page.getByRole('link', { name: '@ada' })).toBeVisible();
  });

  it('a 400 shows the server text, associated with the input and focused', async () => {
    reply(400, { error: 'That handle is taken.' });
    await render(AccountOffer);
    await userEvent.type(field(), 'ada');
    await save().click();
    const text = page.getByText('That handle is taken.');
    await expect.element(text).toBeVisible();
    await expect.element(field()).toHaveFocus();
    expect(field().element().getAttribute('aria-describedby')).toBe(text.element().id);
  });

  it('a 429 shows the body text', async () => {
    reply(429, { error: 'Too many changes. Wait a moment.' });
    await render(AccountOffer);
    await userEvent.type(field(), 'ada');
    await save().click();
    await expect.element(page.getByText('Too many changes. Wait a moment.')).toBeVisible();
  });

  it('a 401 shows Sign in first.', async () => {
    reply(401, { error: 'x' });
    await render(AccountOffer);
    await userEvent.type(field(), 'ada');
    await save().click();
    await expect.element(page.getByText('Sign in first.')).toBeVisible();
  });

  it('a 500 shows the generic text', async () => {
    reply(500, { error: 'boom' });
    await render(AccountOffer);
    await userEvent.type(field(), 'ada');
    await save().click();
    await expect.element(page.getByText("Couldn't save. Try again.")).toBeVisible();
  });

  it('a thrown fetch shows the network text', async () => {
    fetchSpy.mockRejectedValueOnce(new TypeError('offline'));
    await render(AccountOffer);
    await userEvent.type(field(), 'ada');
    await save().click();
    await expect
      .element(page.getByText("Couldn't reach the server. Check your connection."))
      .toBeVisible();
    await expect.element(save()).toBeEnabled();
  });
});

describe('AccountOffer accessibility', () => {
  for (const mode of ['light', 'dark'] as const) {
    it(`field state passes axe in ${mode}, controls are 24 px`, async () => {
      sync.account = { handle: 'quiet-fox-12', handleClaimed: false };
      await scheme(mode);
      const view = await render(AccountOffer);
      await userEvent.type(field(), 'ada');
      const r = await axe.run(view.container, { runOnly: TAGS });
      expect(r.violations).toEqual([]);
      expect(save().element().getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
      expect(field().element().getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
    });

    it(`chosen state passes axe in ${mode}`, async () => {
      sync.account = { handle: 'bold-owl-7', handleClaimed: true };
      await scheme(mode);
      const view = await render(AccountOffer);
      const r = await axe.run(view.container, { runOnly: TAGS });
      expect(r.violations).toEqual([]);
    });
  }
});
