/// <reference types="@vitest/browser-playwright" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import type { ManifestSources } from '$lib/data/manifest';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { PROJECTS_JSON } from '$lib/fzp/fixtures/projects';
import { QUALITY_HEADING, QUALITY_LOAD_FAILED, modelSections } from '$lib/fzp/provenance';
import calibrationJson from '../../../e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json';
import AboutAssumptions from './AboutAssumptions.svelte';
import { ABOUT_ID, ASSUMPTIONS_FAILED, ASSUMPTIONS_SHOW, PART_HEADING } from './copy';

const CAL_URL = '/data/fixture-0/scenarios/fzp/calibration.json';
const PROJECTS_URL = '/data/fixture-0/scenarios/fzp/projects.json';

const manifest: ManifestSources = {
  datasetVersion: 'fixture-0',
  builtAt: '2026-10-09T12:00:00Z',
  sources: [],
  scenarios: {
    fzp: {
      parcels: '/data/fixture-0/scenarios/fzp/parcels.bin',
      projects: PROJECTS_URL,
      calibration: CAL_URL
    }
  }
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

/** Answers each data file by its URL; the calibration through `calibration` when given. */
function stub(calibration?: () => Promise<Response>) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === CAL_URL)
      return calibration ? calibration() : Promise.resolve(json(calibrationJson));
    if (url === PROJECTS_URL) return Promise.resolve(json(PROJECTS_JSON));
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
}

const callsTo = (fn: ReturnType<typeof stub>, url: string) =>
  fn.mock.calls.filter(([u]) => String(u) === url).length;

async function setup(
  over: { fetchFn?: ReturnType<typeof stub>; manifest?: ManifestSources | null } = {}
) {
  const fetchFn = over.fetchFn ?? stub();
  const view = await render(AboutAssumptions, {
    level: 2,
    datasetVersion: 'fixture-0',
    manifest: over.manifest === undefined ? manifest : over.manifest,
    fetchFn: fetchFn as unknown as typeof fetch
  });
  return { fetchFn, view };
}

const part = () => document.getElementById(ABOUT_ID.assumptions)!;
const summary = () => page.getByText(ASSUMPTIONS_SHOW, { exact: true });
const sectionHeadings = () =>
  [...part().querySelectorAll('h3')].map((h) => h.textContent?.trim() ?? '');
const expected = () => [
  ...modelSections(fixtureCalibration()).map((s) => s.heading),
  QUALITY_HEADING
];

afterEach(() => {
  history.replaceState(null, '', location.pathname + location.search);
  vi.restoreAllMocks();
});

describe('AboutAssumptions on the page', () => {
  it('closed: nothing is fetched', async () => {
    const { fetchFn } = await setup();
    await expect
      .element(page.getByRole('heading', { level: 2, name: PART_HEADING.assumptions }))
      .toBeVisible();
    await expect.element(summary()).toBeVisible();
    expect(part().querySelector('details')?.open).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(part().querySelector('h3')).toBeNull();
  });

  it('opening fetches the calibration once and renders every section heading of modelSections', async () => {
    let answer!: (r: Response) => void;
    const fetchFn = stub(
      () =>
        new Promise<Response>((res) => {
          answer = res;
        })
    );
    await setup({ fetchFn });
    await summary().click();
    const status = part().querySelector('[role="status"]')!;
    await expect.poll(() => status.textContent?.trim()).toBe('Loading…');
    expect(callsTo(fetchFn, CAL_URL)).toBe(1);
    answer(json(calibrationJson));
    await expect.poll(sectionHeadings).toEqual(expected());
    // The status region stays mounted and empties once the assumptions are in.
    expect(part().querySelector('[role="status"]')).toBe(status);
    expect(status.textContent?.trim()).toBe('');
    // The data checks load with the body.
    await expect.poll(() => callsTo(fetchFn, PROJECTS_URL)).toBe(1);
    await expect
      .poll(() => document.getElementById('src-quality')?.querySelectorAll('tbody tr').length)
      .toBe(3);
    // Closed and opened again: nothing more is fetched.
    await summary().click();
    await summary().click();
    expect(callsTo(fetchFn, CAL_URL)).toBe(1);
    expect(callsTo(fetchFn, PROJECTS_URL)).toBe(1);
    // The sections sit one level under the part, their entries one more.
    expect(document.getElementById('src-transitions')!.querySelector('h4')).not.toBeNull();
  });

  it('a failure shows "The assumptions couldn\'t load." and Retry; Retry loads', async () => {
    const fail = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(() => Promise.resolve(json(calibrationJson)));
    const fetchFn = stub(fail);
    await setup({ fetchFn });
    await summary().click();
    await expect.element(page.getByText(ASSUMPTIONS_FAILED)).toBeVisible();
    expect(ASSUMPTIONS_FAILED).toBe("The assumptions couldn't load.");
    const retry = page.getByRole('button', { name: 'Retry' });
    await expect.element(retry).toBeVisible();
    expect(retry.element().className).toContain('underline');
    expect(sectionHeadings()).toEqual([]);
    await retry.click();
    await expect.poll(sectionHeadings).toEqual(expected());
    expect(callsTo(fetchFn, CAL_URL)).toBe(2);
    expect(part().textContent).not.toContain(ASSUMPTIONS_FAILED);
  });

  it('a hash for an entry opens the assumptions and scrolls to it', async () => {
    history.replaceState(null, '', '#src-transitions');
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const { fetchFn } = await setup();
    await expect.poll(() => scroll.mock.calls.length).toBe(1);
    expect(part().querySelector('details')?.open).toBe(true);
    expect(callsTo(fetchFn, CAL_URL)).toBe(1);
    expect(scroll.mock.contexts[0]).toBe(document.getElementById('src-transitions'));
    expect(scroll.mock.calls[0][0]).toEqual({ block: 'start' });
    // Once: a later render (the data checks arriving) does not scroll again.
    await expect
      .poll(() => document.getElementById('src-quality')?.querySelectorAll('tbody tr').length)
      .toBe(3);
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('a delayed landing focuses the target without scrolling again, so Tab starts there', async () => {
    history.replaceState(null, '', '#src-pathway');
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    await setup();
    await expect.poll(() => scroll.mock.calls.length).toBe(1);
    const target = document.getElementById('src-pathway')!;
    expect(document.activeElement).toBe(target);
    expect(target.tabIndex).toBe(-1);
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it("the part's own id opens the assumptions too", async () => {
    history.replaceState(null, '', `#${ABOUT_ID.assumptions}`);
    await setup();
    await expect.poll(sectionHeadings).toEqual(expected());
    expect(part().querySelector('details')?.open).toBe(true);
  });

  it('after a failure, Retry loads and the hash still lands', async () => {
    history.replaceState(null, '', '#src-pathway');
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const fail = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(() => Promise.resolve(json(calibrationJson)));
    await setup({ fetchFn: stub(fail) });
    await expect.element(page.getByText(ASSUMPTIONS_FAILED)).toBeVisible();
    expect(scroll).not.toHaveBeenCalled();
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect.poll(() => scroll.mock.calls.length).toBe(1);
    expect(scroll.mock.contexts[0]).toBe(document.getElementById('src-pathway'));
  });

  it('a hash change after load opens the assumptions and lands; unmounted, nothing listens', async () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const { fetchFn, view } = await setup();
    await expect.element(summary()).toBeVisible();
    expect(fetchFn).not.toHaveBeenCalled();
    location.hash = '#src-pathway';
    await expect.poll(() => scroll.mock.calls.length).toBe(1);
    expect(part().querySelector('details')?.open).toBe(true);
    expect(scroll.mock.contexts[0]).toBe(document.getElementById('src-pathway'));
    // An unrelated hash afterwards changes nothing.
    location.hash = `#${ABOUT_ID.data}`;
    await expect.poll(() => location.hash).toBe(`#${ABOUT_ID.data}`);
    expect(scroll).toHaveBeenCalledTimes(1);
    await view.unmount();
    const calls = fetchFn.mock.calls.length;
    location.hash = '#src-transitions';
    await expect.poll(() => location.hash).toBe('#src-transitions');
    expect(fetchFn.mock.calls.length).toBe(calls);
    expect(scroll).toHaveBeenCalledTimes(1);
  });

  it('a malformed hash (#100%) neither throws nor opens the assumptions', async () => {
    history.replaceState(null, '', '#100%');
    const { fetchFn } = await setup();
    await expect.element(summary()).toBeVisible();
    expect(part().querySelector('details')?.open).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('an unrelated hash leaves the assumptions closed', async () => {
    history.replaceState(null, '', `#${ABOUT_ID.data}`);
    const { fetchFn } = await setup();
    await expect.element(summary()).toBeVisible();
    expect(part().querySelector('details')?.open).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('no fzp scenario (or no manifest): the heading and the failure line, without Retry or a disclosure', async () => {
    for (const m of [{ ...manifest, scenarios: undefined }, null]) {
      const { fetchFn, view } = await setup({ manifest: m });
      await expect
        .element(page.getByRole('heading', { level: 2, name: PART_HEADING.assumptions }))
        .toBeVisible();
      await expect.element(page.getByText(ASSUMPTIONS_FAILED)).toBeVisible();
      expect(part().querySelector('details')).toBeNull();
      expect(part().querySelector('button')).toBeNull();
      expect(fetchFn).not.toHaveBeenCalled();
      await view.unmount();
    }
  });
});

describe('the data checks: one way to load them', () => {
  it('on the page, closing and reopening after a failed data-checks load retries', async () => {
    const projects = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(() => Promise.resolve(json(PROJECTS_JSON)));
    const fetchFn = vi.fn((input: RequestInfo | URL) =>
      String(input) === CAL_URL ? Promise.resolve(json(calibrationJson)) : projects()
    );
    await setup({ fetchFn: fetchFn as unknown as ReturnType<typeof stub> });
    await summary().click();
    await expect
      .poll(() => document.getElementById('src-quality')?.textContent)
      .toContain(QUALITY_LOAD_FAILED);
    await summary().click();
    await summary().click();
    await expect
      .poll(() => document.getElementById('src-quality')?.querySelectorAll('tbody tr').length)
      .toBe(3);
    expect(projects).toHaveBeenCalledTimes(2);
    expect(callsTo(fetchFn as unknown as ReturnType<typeof stub>, CAL_URL)).toBe(1);
  });
});

describe('AboutAssumptions live (the dialog)', () => {
  const live = async (fetchFn: ReturnType<typeof stub> | ReturnType<typeof vi.fn>) =>
    render(AboutAssumptions, {
      level: 3,
      live: { sections: modelSections(fixtureCalibration()), projectsUrl: PROJECTS_URL },
      fetchFn: fetchFn as unknown as typeof fetch
    });

  it('live sections render at once with no disclosure, and fetch nothing until loadChecks', async () => {
    const fetchFn = stub();
    const view = await live(fetchFn);
    await expect
      .element(page.getByRole('heading', { level: 3, name: PART_HEADING.assumptions }))
      .toBeVisible();
    expect(part().querySelector('details')).toBeNull();
    expect([...part().querySelectorAll('h4')].map((h) => h.textContent?.trim())).toEqual(
      expected()
    );
    expect(fetchFn).not.toHaveBeenCalled();
    view.component.loadChecks();
    await expect
      .poll(() => document.getElementById('src-quality')?.querySelectorAll('tbody tr').length)
      .toBe(3);
    // Loaded: a second call fetches nothing more.
    view.component.loadChecks();
    expect(callsTo(fetchFn, PROJECTS_URL)).toBe(1);
    expect(callsTo(fetchFn, CAL_URL)).toBe(0);
  });

  it('after a failure the next loadChecks tries again', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(() => Promise.resolve(json(PROJECTS_JSON)));
    const view = await live(fetchFn);
    view.component.loadChecks();
    await expect
      .poll(() => document.getElementById('src-quality')?.textContent)
      .toContain(QUALITY_LOAD_FAILED);
    view.component.loadChecks();
    await expect
      .poll(() => document.getElementById('src-quality')?.querySelectorAll('tbody tr').length)
      .toBe(3);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
