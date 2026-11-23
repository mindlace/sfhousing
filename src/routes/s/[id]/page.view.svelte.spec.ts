/// <reference types="@vitest/browser-playwright" />
// /s/[id] (plan 5, Task 6; timeline-ui Task 15; game-shell Task 6): a published policy, read-only
// on the timeline. The data comes through the real chain: the server codec's `load` (the stored
// text), then the universal load (opens it on the calibration). The banner names it and, under a
// provided game, offers Remix, which makes a saved game holding the opened schema 4 document and
// loads /sim (a spy on `loadPage`). A fake timeline worker stands in for the scenario worker;
// SimMap is a stub.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../layout.css';
import { page as appPage } from '$app/state';
import { manifestUrl } from '$lib/data/manifest';
import { stub } from '$lib/fzp/test/sim-map-stub';
import { FULL_TEXT, STORAGE_TEXT } from '$lib/game/copy';
import { SAVES_KEY } from '$lib/game/saves';
import { emptyPlan, serializePlan } from '$lib/plan';
import { REMIX_LATER, REMIX_LOCKED, YOUR_GAME, remixNeeds } from '$lib/sharing/copy';
import { readRecord } from '$lib/sharing/storage';
import { seededGame } from '$lib/shell/test/seeded-game';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { monthFirstDay } from '$lib/sim/world/months';
import { tampered4Text } from '$lib/server/test/sim-docs';
import { SIM_KEY } from '$lib/sim-page/sim-doc';
import { TIMING_NOTICE_TEXT } from '$lib/sim-page/sim-session';
import { DEFAULT_POLICY4, type Policy, type SimPolicy4 } from '$lib/timeline/policy4';
import { SIM_SERVER_CODEC4 } from '$lib/timeline/server-codec';
import { SIM_KEY4, serializeSimDoc4, type SimDoc4 } from '$lib/timeline/sim-doc4';
import type { FakeTimelineWorker } from '$lib/timeline/test/fake-timeline-worker';
import manifestJson from '../../../../e2e/fixtures/data/fixture-0/manifest.json';
import calibrationJson from '../../../../e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json';
import schema2Painted from '$lib/sim-page/fixtures/schema2/painted.json?raw';
import { load } from './+page';
import PageHost from './test/PageHost.svelte';

const nav = vi.hoisted(() => ({
  goto: [] as { url: string; opts?: { state?: App.PageState } }[]
}));
const nav2 = vi.hoisted(() => ({ loadPage: vi.fn() }));
const workers = vi.hoisted(() => [] as FakeTimelineWorker[]);

vi.mock('$lib/map/SimMap.svelte', () => import('$lib/fzp/test/FzpSimMapStub.svelte'));
vi.mock('$lib/sim/client', async (orig) => {
  const { FakeTimelineWorker } = await import('$lib/timeline/test/fake-timeline-worker');
  return {
    ...(await orig<typeof import('$lib/sim/client')>()),
    spawnSimWorker: () => {
      const w = new FakeTimelineWorker();
      workers.push(w);
      return w;
    }
  };
});
vi.mock('$app/navigation', () => ({
  afterNavigate: () => {},
  replaceState: () => {},
  goto: async (url: string, opts?: { state?: App.PageState }) => {
    nav.goto.push({ url, opts });
  }
}));
vi.mock('$lib/game/navigate', async (orig) => ({
  ...(await orig<typeof import('$lib/game/navigate')>()),
  loadPage: nav2.loadPage
}));

const cal = fixtureCalibration();
const M = (k: number) => monthFirstDay(cal.asOf, k);

const historic: Policy = {
  id: 'historic',
  label: 'Protect historic buildings',
  preset: null,
  on: true,
  where: { tag: 'category', category: 'historic' },
  spans: [{ from: M(2), to: null, what: { tag: 'protect', years: null } }]
};
/** A money policy on a pool of its own (`preset` null): no level runs it. */
const ownPool: Policy = {
  id: 'm2',
  label: 'Grants from City money',
  preset: null,
  on: true,
  where: { tag: 'fund', pool: 'city' },
  spans: [{ from: M(4), to: null, what: { tag: 'fund', pool: null, programmes: [] } }]
};
const zoning = (...z: Policy[]): SimPolicy4 => ({
  schema: 4,
  kinds: { ...DEFAULT_POLICY4.kinds, zoning: z }
});
const withMoney = (...m: Policy[]): SimPolicy4 => ({
  schema: 4,
  kinds: { ...DEFAULT_POLICY4.kinds, money: [...DEFAULT_POLICY4.kinds.money, ...m] }
});
/** The old game's plan record, which a policy remix keeps. */
const OLD_PLAN_RECORD = JSON.stringify({
  v: 1,
  savedAt: '2026-11-01T00:00:00.000Z',
  plan: serializePlan(emptyPlan('fixture-0'))
});
const doc4 = (policy: SimPolicy4, title?: string): SimDoc4 => ({
  schema: 4,
  kind: 'sim',
  datasetVersion: 'fixture-0',
  ...(title === undefined ? {} : { title }),
  policy
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const files = async (url: string) => {
  if (url === manifestUrl('fixture-0')) return json(manifestJson);
  if (url === manifestJson.scenarios.fzp.calibration) return json(calibrationJson);
  throw new Error(`unexpected fetch ${url}`);
};

/** The page's data for a stored row of `text`: the server codec's load, then the universal load. */
async function dataFor(text: string, o: { upgradedFrom?: number } = {}) {
  const stored = SIM_SERVER_CODEC4.load(text);
  if (!stored.ok) throw new Error('fixture');
  const server = {
    id: 'Abcdefg2',
    doc: stored.value,
    createdAt: '2026-10-30T12:00:00.000Z',
    currentDatasetVersion: 'fixture-0',
    datasetNotice: 'none' as const,
    ...(o.upgradedFrom === undefined ? {} : { upgradedFrom: o.upgradedFrom }),
    datasetVersion: 'fixture-0',
    appRelease: 'dev',
    user: null,
    signInAvailable: true
  };
  const r = await load({
    data: server,
    fetch: files,
    url: new URL('http://x/s/Abcdefg2')
  } as never);
  return { ...server, ...(r as object) } as ComponentProps<typeof PageHost>['data'];
}

const banner = () => page.getByRole('region', { name: 'Shared policy' });
const notices = () => page.getByTestId('sim-notices');
const w = () => workers[workers.length - 1];
const remixBtn = () => banner().getByRole('button', { name: 'Remix', exact: true });
const yourGame = () => banner().getByRole('link', { name: YOUR_GAME });

describe('/s/[id] read-only view', () => {
  beforeEach(async () => {
    stub.reset();
    workers.length = 0;
    nav.goto.length = 0;
    appPage.state = {};
    localStorage.removeItem(SIM_KEY);
    localStorage.removeItem(SIM_KEY4);
    await page.viewport(1280, 900);
  });

  afterEach(() => {
    localStorage.removeItem(SIM_KEY);
    localStorage.removeItem(SIM_KEY4);
  });

  it('the open game: no Remix button, and Your game shows', async () => {
    const data = await dataFor(serializeSimDoc4(doc4(zoning(historic), 'SD permits')));
    await render(PageHost, { props: { data } });
    await expect.element(banner()).toBeVisible();
    await expect.element(banner()).toHaveTextContent(/SD permits · Shared policy · published/);
    await expect.element(yourGame()).toBeVisible();
    expect(remixBtn().elements()).toHaveLength(0);
    expect(banner().getByRole('button', { name: REMIX_LOCKED }).elements()).toHaveLength(0);
    expect(banner().getByRole('link', { name: 'Start your own' }).elements()).toHaveLength(0);
    await expect.poll(() => document.title).toBe('SD permits · SF Housing Simulator');
  });

  it('/s shows the shared timeline read-only', async () => {
    const data = await dataFor(serializeSimDoc4(doc4(zoning(historic), 'SD permits')));
    await render(PageHost, { props: { data } });
    await expect.poll(() => w()?.lastOf('openTimeline')).toBeTruthy();
    expect(w().lastOf('openTimeline')!.policy).toEqual(zoning(historic));
    await expect.element(page.getByTestId('tl-timeline')).toBeVisible();
    expect(page.getByRole('button', { name: /^Add .* policy$/ }).elements()).toHaveLength(0);
    expect(page.getByRole('button', { name: /^Undo|^Redo/ }).elements()).toHaveLength(0);
    expect(page.getByRole('button', { name: /Publish|Share link/ }).elements()).toHaveLength(0);
    // The status slot holds the fill status only: no save state.
    expect(page.getByText('Saved').elements()).toHaveLength(0);
    expect(document.querySelector('[data-header-status]')?.textContent).not.toMatch(/Sav|Autosave/);
    // Nothing is autosaved from the view, under either key.
    expect(localStorage.getItem(SIM_KEY4)).toBeNull();
    expect(localStorage.getItem(SIM_KEY)).toBeNull();
  });

  it('a schema 2 link keeps its "funding-added" notice', async () => {
    const data = await dataFor(schema2Painted, { upgradedFrom: 2 });
    await render(PageHost, { props: { data } });
    await expect
      .element(notices().getByText(/saved before public money could be added/))
      .toBeVisible();
  });

  it('a tampered link opens refit, with the timing notice', async () => {
    const data = await dataFor(tampered4Text());
    await render(PageHost, { props: { data } });
    await expect.element(notices().getByText(TIMING_NOTICE_TEXT)).toBeVisible();
    await expect.poll(() => w()?.lastOf('openTimeline')).toBeTruthy();
    // The worker runs the reconciled set, not the tampered scale.
    const [timing] = w().lastOf('openTimeline')!.policy.kinds.permitting;
    const what = timing.spans[0].what;
    expect(what.tag === 'timing' && what.set.presetTimers.every((t) => t.scale !== 0.2)).toBe(true);
  });
});

describe('/s/[id] Remix under a game', () => {
  beforeEach(async () => {
    stub.reset();
    workers.length = 0;
    nav.goto.length = 0;
    nav2.loadPage.mockClear();
    appPage.state = {};
    await page.viewport(1280, 900);
  });

  const SD = () => dataFor(serializeSimDoc4(doc4(zoning(historic), 'SD permits')));

  it('level 1: the button reads "Unlock the simulation to remix" and a press stores nothing', async () => {
    const { game, storage } = seededGame({ level: 1 });
    const index = storage.getItem(SAVES_KEY);
    await render(PageHost, { props: { data: await SD(), game } });
    const locked = banner().getByRole('button', { name: REMIX_LOCKED });
    await expect.element(locked).toHaveAttribute('aria-disabled', 'true');
    expect(remixBtn().elements()).toHaveLength(0);
    (locked.element() as HTMLElement).click();
    expect(storage.getItem(SAVES_KEY)).toBe(index);
    expect(game.saves).toHaveLength(1);
    expect(nav2.loadPage).not.toHaveBeenCalled();
  });

  it('level 3 with a zoning policy: "Level 4 runs all of it"', async () => {
    const { game } = seededGame({ level: 3 });
    await render(PageHost, { props: { data: await SD(), game } });
    await expect.element(remixBtn()).toBeVisible();
    await expect.element(banner().getByText(remixNeeds(4), { exact: true })).toBeVisible();
    expect(remixNeeds(4)).toBe('Level 4 runs all of it');
  });

  it('level 3 with an own pool: "Parts unlock in a later round"', async () => {
    const { game } = seededGame({ level: 3 });
    const data = await dataFor(serializeSimDoc4(doc4(withMoney(ownPool), 'Own bond')));
    await render(PageHost, { props: { data, game } });
    await expect.element(remixBtn()).toBeVisible();
    await expect.element(banner().getByText(REMIX_LATER, { exact: true })).toBeVisible();
    expect(REMIX_LATER).toBe('Parts unlock in a later round');
  });

  it('level 3: a press makes "Remix of {title}" with the rebased policy and the old plan, current, and loads /sim', async () => {
    const { game, storage } = seededGame({ level: 3, plan: OLD_PLAN_RECORD });
    await render(PageHost, { props: { data: await SD(), game } });
    await remixBtn().click();
    await expect.poll(() => nav2.loadPage.mock.calls.length).toBe(1);
    expect(nav2.loadPage).toHaveBeenCalledWith('/sim');
    expect(game.saves).toHaveLength(2);
    expect(game.saves[0].name).toBe('Remix of SD permits');
    expect(game.currentId).toBe(game.saves[0].id);
    const r = readRecord(storage, SIM_SERVER_CODEC4);
    expect(r.kind === 'ok' && r.plan.policy).toEqual(zoning(historic));
    expect(r.kind === 'ok' && r.plan.title).toBe('SD permits');
    expect(game.read(game.currentId)!.plan).toBe(OLD_PLAN_RECORD);
    // No dialog asks first, nothing goes through history state, and the page's own
    // localStorage keys stay untouched.
    expect(page.getByRole('dialog').elements()).toHaveLength(0);
    expect(nav.goto).toHaveLength(0);
    expect(localStorage.getItem(SIM_KEY4)).toBeNull();
    expect(localStorage.getItem(SIM_KEY)).toBeNull();
  });

  it('a double press makes one saved game', async () => {
    const { game } = seededGame({ level: 3 });
    await render(PageHost, { props: { data: await SD(), game } });
    await expect.element(remixBtn()).toBeVisible();
    const el = remixBtn().element() as HTMLElement;
    el.click();
    el.click();
    expect(game.saves).toHaveLength(2);
    expect(nav2.loadPage).toHaveBeenCalledTimes(1);
  });

  it('at 12 saved games Remix is disabled and the full line shows', async () => {
    const { game, storage } = seededGame({ level: 3, saves: 12 });
    const index = storage.getItem(SAVES_KEY);
    await render(PageHost, { props: { data: await SD(), game } });
    await expect.element(remixBtn()).toHaveAttribute('aria-disabled', 'true');
    await expect.element(banner().getByText(FULL_TEXT, { exact: true })).toBeVisible();
    (remixBtn().element() as HTMLElement).click();
    expect(storage.getItem(SAVES_KEY)).toBe(index);
    expect(game.saves).toHaveLength(12);
    expect(nav2.loadPage).not.toHaveBeenCalled();
  });

  it('a storage that refuses writes shows the refused line', async () => {
    const { game, storage } = seededGame({ level: 3 });
    await render(PageHost, { props: { data: await SD(), game } });
    await expect.element(remixBtn()).toBeVisible();
    storage.failWrites = true;
    await remixBtn().click();
    await expect.element(banner().getByRole('alert')).toHaveTextContent(STORAGE_TEXT);
    expect(game.saves).toHaveLength(1);
    expect(nav2.loadPage).not.toHaveBeenCalled();
  });

  it('Your game links gamePath(level): / at level 1, /sim above it', async () => {
    const first = await render(PageHost, {
      props: { data: await SD(), game: seededGame({ level: 1 }).game }
    });
    await expect.element(yourGame()).toHaveAttribute('href', '/');
    await first.unmount();
    await render(PageHost, { props: { data: await SD(), game: seededGame({ level: 3 }).game } });
    await expect.element(yourGame()).toHaveAttribute('href', '/sim');
  });

  it('a schema 2 link remixes as schema 4', async () => {
    const { game, storage } = seededGame({ level: 5 });
    const data = await dataFor(schema2Painted, { upgradedFrom: 2 });
    await render(PageHost, { props: { data, game } });
    await remixBtn().click();
    await expect.poll(() => nav2.loadPage.mock.calls.length).toBe(1);
    expect(nav2.loadPage).toHaveBeenCalledWith('/sim');
    const r = readRecord(storage, SIM_SERVER_CODEC4);
    expect(r.kind === 'ok' && r.plan.schema).toBe(4);
  });
});
