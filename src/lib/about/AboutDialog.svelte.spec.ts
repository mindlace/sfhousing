/// <reference types="@vitest/browser-playwright" />
import type { ComponentProps } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { cdp, page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { parseManifest } from '$lib/data/manifest';
import { fixtureCalibration } from '$lib/fzp/fixtures/calibration';
import { liveMarketCalibration } from '$lib/fzp/fixtures/market';
import { PROJECTS_JSON, PROJECTS_JSON_NO_RULES } from '$lib/fzp/fixtures/projects';
import { TIMELINE_SCORE, TIMELINE_SCORE_NO_PHASING } from '$lib/fzp/fixtures/timeline-score';
import { formatDate } from '$lib/fzp/format';
import { TIER_LABEL } from '$lib/fzp/labels';
import {
  NOT_SF_NOTE,
  PERMIT_WINDOW_SENTENCE,
  PHASE_DELAY_SENTENCE,
  QUALITY_EMPTY,
  QUALITY_HEADING,
  QUALITY_LOAD_FAILED,
  QUALITY_PARCEL_SENTENCE,
  TWIN_RESIZE_SENTENCE,
  UNENRICHED_SENTENCE,
  provenanceSections
} from '$lib/fzp/provenance';
import { resolveTerms } from '$lib/sim/finance';
import { PIPELINE_FUNDED } from '$lib/sim/scenario/funding';
import manifestJson from '../../../e2e/fixtures/data/fixture-0/manifest.json';
import { ABOUT_ID, ABOUT_TITLE, PART_HEADING } from './copy';
import AboutDialogHarness from './test/AboutDialogHarness.svelte';

const cal = fixtureCalibration();
const manifest = parseManifest(manifestJson);
const URL_ = '/data/fixture-0/scenarios/fzp/projects.json';

type Props = ComponentProps<typeof AboutDialogHarness>;

const jsonResponse = (body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

async function setup(over: Partial<Props> = {}) {
  await page.viewport(1280, 800);
  const fetchFn = vi.fn((_url: RequestInfo | URL) => jsonResponse(PROJECTS_JSON));
  const onopen = vi.fn();
  const props: Props = {
    manifest,
    datasetVersion: 'fixture-0',
    sections: provenanceSections(cal, TIMELINE_SCORE),
    projectsUrl: URL_,
    fetchFn: fetchFn as unknown as typeof fetch,
    onopen,
    ...over
  };
  const view = await render(AboutDialogHarness, { props });
  return { fetchFn, onopen, view };
}

async function scheme(value: 'light' | 'dark') {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value }]
  });
}

const dialog = () => document.querySelector('dialog') as HTMLDialogElement;
const byId = (id: string) => dialog().querySelector(`[id="${id}"]`) as HTMLElement;
const scroller = () => dialog().querySelector('[data-about-scroll]') as HTMLElement;
const opener = () => page.getByRole('button', { name: 'Sources', exact: true });
const linkNamed = (name: string) =>
  page.getByRole('link', { name, exact: true }).element() as HTMLAnchorElement;

async function openIt() {
  await opener().click();
  expect(dialog().open).toBe(true);
}

/** The target's top sits at the top of the dialog's scroll box (within a few px). */
async function expectAtTop(id: string) {
  await expect
    .poll(() => {
      const el = byId(id);
      if (!el) return Infinity;
      return Math.abs(el.getBoundingClientRect().top - scroller().getBoundingClientRect().top);
    })
    .toBeLessThan(24);
  // Only the scroll box moved: the title row and Close stay in view.
  expect(dialog().scrollTop).toBe(0);
  const head = dialog().querySelector('h2')!.getBoundingClientRect();
  expect(head.top).toBeGreaterThanOrEqual(dialog().getBoundingClientRect().top);
}

/**
 * Dispatches a click as the browser would for a modified or other-button press, and reports
 * whether anything before the window's bubble phase claimed it. The window listener then stops
 * the navigation, so the test page stays put.
 */
function clickWith(a: HTMLElement, init: MouseEventInit): boolean {
  let claimed = true;
  const last = (e: Event) => {
    claimed = e.defaultPrevented;
    e.preventDefault();
  };
  window.addEventListener('click', last, { once: true });
  a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
  window.removeEventListener('click', last);
  return claimed;
}

afterEach(async () => {
  if (dialog()?.open) dialog().close();
  await scheme('light');
});

describe('links to About', () => {
  it('a plain click on an About link opens the dialog at the fragment and the page does not navigate', async () => {
    const { onopen } = await setup();
    const before = location.href;
    await page.getByRole('link', { name: 'Data link', exact: true }).click();
    expect(dialog().open).toBe(true);
    expect(onopen).toHaveBeenCalledTimes(1);
    expect(location.href).toBe(before);
    await expectAtTop(ABOUT_ID.data);
    dialog().close();
    // An entry's id, and the bare /about (the top).
    await page.getByRole('link', { name: 'Entitled link', exact: true }).click();
    expect(dialog().open).toBe(true);
    await expectAtTop('src-transition-discretionary-entitled');
    dialog().close();
    await page.getByRole('link', { name: 'About', exact: true }).click();
    expect(dialog().open).toBe(true);
    await expect.poll(() => scroller().scrollTop).toBe(0);
    expect(location.href).toBe(before);
  });

  it('Enter on an About link opens the dialog like the click', async () => {
    await setup();
    linkNamed('Data link').focus();
    await userEvent.keyboard('{Enter}');
    expect(dialog().open).toBe(true);
    await expectAtTop(ABOUT_ID.data);
  });

  it('a modified click is left to the browser', async () => {
    await setup();
    const a = linkNamed('Data link');
    for (const init of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 }
    ]) {
      expect(clickWith(a, init), JSON.stringify(init)).toBe(false);
      expect(dialog().open, JSON.stringify(init)).toBe(false);
    }
    // A plain click on a new-tab link or a link to another page is the browser's too.
    expect(clickWith(linkNamed('New tab'), {})).toBe(false);
    expect(clickWith(linkNamed('Other page'), {})).toBe(false);
    expect(dialog().open).toBe(false);
    // A click something earlier already handled is not taken.
    const claim = (e: Event) => e.preventDefault();
    window.addEventListener('click', claim, { capture: true, once: true });
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(dialog().open).toBe(false);
    // The same click unmodified is the dialog's.
    expect(clickWith(a, {})).toBe(true);
    expect(dialog().open).toBe(true);
  });

  it('unmounted, a click on an About link is not intercepted', async () => {
    const { view } = await setup();
    const a = document.createElement('a');
    a.href = '/about#about-data';
    a.textContent = 'Outside';
    document.body.appendChild(a);
    try {
      await view.unmount();
      expect(clickWith(a, {})).toBe(false);
    } finally {
      a.remove();
    }
  });
});

describe('opening', () => {
  it('the dialog holds the four parts in order, headed at level 3, with live assumptions', async () => {
    const { onopen } = await setup();
    expect(dialog().open).toBe(false);
    await openIt();
    expect(dialog().matches(':modal')).toBe(true);
    expect(onopen).toHaveBeenCalledTimes(1);
    await expect
      .element(page.getByRole('heading', { level: 2, name: ABOUT_TITLE, exact: true }))
      .toBeVisible();
    expect(dialog().getAttribute('aria-labelledby')).toBe(dialog().querySelector('h2')!.id);
    const parts = [...dialog().querySelectorAll(':scope section[id^="about-"]')]
      .filter((s) => s.id !== ABOUT_ID.shortcuts)
      .map((s) => [s.id, s.querySelector('h3')?.textContent?.trim()]);
    expect(parts).toEqual([
      [ABOUT_ID.meanings, PART_HEADING.meanings],
      [ABOUT_ID.assumptions, PART_HEADING.assumptions],
      [ABOUT_ID.data, PART_HEADING.data],
      [ABOUT_ID.using, PART_HEADING.using]
    ]);
    // Live: the run's sections (Actual completions needs a run), one level under the part.
    const expected = provenanceSections(cal, TIMELINE_SCORE).map((s) => s.heading);
    const h4 = [...byId(ABOUT_ID.assumptions).querySelectorAll('h4')].map((h) =>
      h.textContent?.trim()
    );
    expect(h4).toEqual([...expected, QUALITY_HEADING]);
    expect(byId('src-actual')).not.toBeNull();
    // No disclosure: the dialog is already the place asked for.
    expect(byId(ABOUT_ID.assumptions).querySelector('details')).toBeNull();
  });

  it('traps Tab, closes on Escape and returns focus to the opener', async () => {
    await setup();
    (opener().element() as HTMLElement).focus();
    await openIt();
    expect(dialog().contains(document.activeElement)).toBe(true);
    const count = dialog().querySelectorAll('a[href], button').length;
    for (let i = 0; i < Math.min(count + 2, 40); i++) {
      await userEvent.tab();
      expect(dialog().contains(document.activeElement)).toBe(true);
    }
    await userEvent.tab({ shift: true });
    expect(dialog().contains(document.activeElement)).toBe(true);
    await userEvent.keyboard('{Escape}');
    expect(dialog().open).toBe(false);
    expect(document.activeElement).toBe(opener().element());
  });

  it('Tab wraps inside the dialog over every focusable kind, a <summary> and a [tabindex] among them', async () => {
    await setup();
    await openIt();
    const extra = document.createElement('div');
    extra.innerHTML =
      '<div tabindex="0" data-testid="scroller">Scroll</div><details><summary>More</summary></details>';
    dialog().appendChild(extra);
    const close = dialog().querySelector('button')!;
    const summary = extra.querySelector('summary')!;
    const scrollerEl = extra.querySelector('[tabindex]') as HTMLElement;
    try {
      close.focus();
      await userEvent.tab({ shift: true });
      expect(document.activeElement).toBe(summary);
      await userEvent.tab({ shift: true });
      expect(document.activeElement).toBe(scrollerEl);
      summary.focus();
      await userEvent.tab();
      expect(document.activeElement).toBe(close);
    } finally {
      extra.remove();
    }
  });

  it('Escape closes it once and is marked handled; a key already handled leaves it open', async () => {
    await setup();
    await openIt();
    // Something under the dialog (a card, the dock) skips a handled Escape.
    let seen: boolean | null = null;
    const under = (e: KeyboardEvent) => {
      if (e.key === 'Escape') seen = e.defaultPrevented;
    };
    window.addEventListener('keydown', under);
    // An explanation that took this Escape first (Explain, capture phase on the window).
    const explain = (e: KeyboardEvent) => e.preventDefault();
    window.addEventListener('keydown', explain, { capture: true, once: true });
    try {
      await userEvent.keyboard('{Escape}');
      expect(dialog().open).toBe(true);
      await userEvent.keyboard('{Escape}');
      expect(dialog().open).toBe(false);
      expect(seen).toBe(true);
    } finally {
      window.removeEventListener('keydown', under);
    }
  });

  it('closes from its Close button', async () => {
    await setup();
    await openIt();
    await page.getByRole('button', { name: 'Close' }).click();
    expect(dialog().open).toBe(false);
  });

  it('open("src-…") scrolls the entry into view; open("about-data") the part', async () => {
    await setup();
    await page.getByRole('button', { name: 'Open at entitled' }).click();
    expect(dialog().open).toBe(true);
    await expectAtTop('src-transition-discretionary-entitled');
    const box = dialog().getBoundingClientRect();
    const top = byId('src-transition-discretionary-entitled').getBoundingClientRect().top;
    expect(top).toBeGreaterThanOrEqual(box.top);
    expect(top).toBeLessThan(box.bottom);
    dialog().close();
    await page.getByRole('button', { name: 'Open at data' }).click();
    await expectAtTop(ABOUT_ID.data);
  });

  it('a targeted open focuses the target, so the first Tab starts there', async () => {
    await setup();
    await page.getByRole('button', { name: 'Open at entitled' }).click();
    await expectAtTop('src-transition-discretionary-entitled');
    const entry = byId('src-transition-discretionary-entitled');
    // The entry's heading: one line, so a focus ring is never drawn around the whole card.
    const heading = entry.querySelector('h1, h2, h3, h4, h5, h6')!;
    await expect.poll(() => document.activeElement).toBe(heading);
    await userEvent.keyboard('{Tab}');
    expect(entry.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.matches('a[href]')).toBe(true);
    await expectAtTop('src-transition-discretionary-entitled');
    dialog().close();
    // With no target, focus stays on Close as before.
    await page.getByRole('button', { name: 'Sources', exact: true }).click();
    await expect.poll(() => document.activeElement?.textContent?.trim()).toBe('Close');
  });

  it('is capped at max-w-2xl and 85vh, and full-width on a phone', async () => {
    await setup();
    await openIt();
    const wide = dialog().getBoundingClientRect();
    expect(wide.width).toBe(672);
    expect(wide.height).toBeLessThanOrEqual(0.85 * 800 + 1);
    dialog().close();
    await page.viewport(375, 700);
    await openIt();
    const narrow = dialog().getBoundingClientRect();
    expect(narrow.width).toBe(375);
    expect(narrow.left).toBeGreaterThanOrEqual(0);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
  });
});

describe('focus on close', () => {
  it('closing returns focus to a visible opener', async () => {
    await setup();
    const a = linkNamed('Data link');
    a.focus();
    await userEvent.keyboard('{Enter}');
    expect(dialog().open).toBe(true);
    await page.getByRole('button', { name: 'Close' }).click();
    expect(document.activeElement).toBe(a);
  });

  it('opened from the Menu, closing returns focus to the Menu button', async () => {
    await setup();
    const menu = page.getByRole('button', { name: 'Menu', exact: true });
    await menu.click();
    await page.getByRole('link', { name: 'About in the Menu', exact: true }).click();
    expect(dialog().open).toBe(true);
    // The Menu closed when its link was pressed: the opener is no longer rendered.
    expect(page.getByTestId('menu-panel').element().getClientRects().length).toBe(0);
    await userEvent.keyboard('{Escape}');
    expect(dialog().open).toBe(false);
    expect(document.activeElement).toBe(menu.element());
  });
});

describe('entries', () => {
  it('shows a tier badge and the label on every parameter entry', async () => {
    await setup();
    await openIt();
    const sections = provenanceSections(cal, TIMELINE_SCORE);
    let seen = 0;
    for (const s of sections) {
      for (const e of s.entries) {
        const el = byId(e.id);
        expect(el, e.id).not.toBeNull();
        seen++;
        const badge = el.querySelector('[data-testid="tier-badge"]');
        expect(badge?.textContent?.trim(), e.id).toBe(TIER_LABEL[e.prov.tier]);
        expect(el.textContent, e.id).toContain(e.prov.label);
        expect(el.textContent?.includes(NOT_SF_NOTE), e.id).toBe(e.research);
        for (const src of e.prov.sources) {
          const a = [...el.querySelectorAll('a')].find((x) => x.textContent?.includes(src.label));
          expect(a?.getAttribute('href'), e.id).toBe(src.url);
        }
      }
    }
    expect(seen).toBeGreaterThan(20);
  });

  it('gives a research-tier entry the note and a tier 2 entry none', async () => {
    await setup();
    await openIt();
    expect(byId('src-transition-discretionary-preApplication').textContent).toContain(NOT_SF_NOTE);
    expect(byId('src-transition-discretionary-entitled').textContent).not.toContain(NOT_SF_NOTE);
  });

  it('puts the tail provenance on each transition and the DQ-1 sentence on permit-side ones', async () => {
    await setup();
    await openIt();
    const permitSide = ['permitFiled', 'permitIssued', 'construction'];
    for (const [pathway, stages] of Object.entries(cal.transitions)) {
      for (const [stage, t] of Object.entries(stages)) {
        const el = byId(`src-transition-${pathway}-${stage}`);
        expect(el.textContent, `${pathway} ${stage}`).toContain(t.tailProvenance.label);
        expect(el.textContent?.includes(PERMIT_WINDOW_SENTENCE), `${pathway} ${stage}`).toBe(
          permitSide.includes(stage)
        );
      }
    }
    expect(byId('src-local-program').textContent).not.toContain(PERMIT_WINDOW_SENTENCE);
  });

  it('shows the within-12/24/60-month shares', async () => {
    await setup();
    await openIt();
    const el = byId('src-transition-discretionary-filed');
    expect(el.textContent).toMatch(/Within 12 months: \d+% advanced/);
    expect(el.textContent).toMatch(/Within 60 months: \d+% advanced/);
  });

  it('renders a table of the initiation intercept across the full width', async () => {
    await setup();
    await openIt();
    const cell = [...byId('src-initiation').querySelectorAll('td')].find((td) =>
      td.textContent?.startsWith('Intercept only:')
    );
    expect(cell?.getAttribute('colspan')).toBe('3');
  });
});

describe('targets and multi-phase', () => {
  it('section 8 shows the twin resize paragraph and when simulated counts start', async () => {
    await setup();
    await openIt();
    const s = byId('src-targets');
    expect(s.textContent).toContain(TWIN_RESIZE_SENTENCE);
    expect(s.textContent).toContain(`Simulated counts start on ${formatDate(cal.asOf)}.`);
  });

  it('section 9 shows the counts, both lists and the first-phase proxy', async () => {
    await setup();
    await openIt();
    const s = byId('src-multiphase');
    expect(s.textContent).toContain('2 multi-phase projects, of which 1 have a published');
    expect(s.textContent).toContain('5 phases are scheduled');
    expect(s.textContent).toContain('3 are estimated');
    expect(s.textContent).toContain(PHASE_DELAY_SENTENCE);
    expect(s.textContent).toContain(UNENRICHED_SENTENCE);
    expect(s.textContent).toContain('Drawn as one footprint (1)');
    expect(s.textContent).toContain('Counted but not drawn (1)');
    expect(s.textContent).toContain('CASE:2012-000020PRX');
    expect(s.textContent).toContain('Score Only Yards');
  });

  it('omits section 9 without phasing, and sections 2 and 8 without a score', async () => {
    const withoutPhasing = await setup({
      sections: provenanceSections(cal, TIMELINE_SCORE_NO_PHASING)
    });
    await openIt();
    expect(byId('src-multiphase')).toBeNull();
    expect(byId('src-targets')).not.toBeNull();
    dialog().close();
    await withoutPhasing.view.unmount();
    await setup({ sections: provenanceSections(cal, null) });
    await openIt();
    expect(byId('src-actual')).toBeNull();
    expect(byId('src-targets')).toBeNull();
  });
});

describe('surface', () => {
  it('draws on the dialog surface tokens, with dark partners', async () => {
    await setup();
    await openIt();
    const cls = [...dialog().classList];
    for (const c of ['bg-surface', 'dark:bg-surface-dark', 'text-ink', 'dark:text-ink-dark'])
      expect(cls, c).toContain(c);
    expect(cls).not.toContain('bg-white');
    expect(getComputedStyle(dialog()).backgroundColor).toBe('rgb(255, 255, 255)');
    // The parts' muted text and rules take the light tokens.
    const caption = byId(ABOUT_ID.shortcuts).querySelector('caption')!;
    expect(getComputedStyle(caption).color).toBe('rgb(75, 85, 99)');
  });

  it("in dark the surface is surface-dark and the parts' muted text is ink-dark-muted", async () => {
    await scheme('dark');
    await setup();
    await openIt();
    expect(getComputedStyle(dialog()).backgroundColor).toBe('rgb(28, 29, 31)');
    expect(getComputedStyle(dialog()).color).toBe('rgb(232, 228, 220)');
    const caption = byId(ABOUT_ID.shortcuts).querySelector('caption')!;
    expect(getComputedStyle(caption).color).toBe('rgb(180, 174, 163)');
    const rule = byId(ABOUT_ID.shortcuts).querySelector('thead tr')!;
    expect(getComputedStyle(rule).borderBottomColor).toBe('rgb(59, 61, 65)');
    const entry = byId('src-transition-discretionary-entitled');
    expect(getComputedStyle(entry).borderTopColor).toBe('rgb(59, 61, 65)');
  });
});

describe('target sizes (spec §4.3)', () => {
  it('Close and every standalone link are at least 24 px tall on every pointer, with no coarse-pointer variant', async () => {
    await setup();
    await openIt();
    // Standalone: Close, the assumptions' source links and the sources table's links. Links
    // inside a sentence are inline and exempt.
    const controls = [
      dialog().querySelector('button')!,
      ...byId(ABOUT_ID.assumptions).querySelectorAll<HTMLElement>('a[href], button'),
      ...byId(ABOUT_ID.data).querySelectorAll<HTMLElement>('td > a[href]')
    ];
    expect(controls.length).toBeGreaterThan(5);
    for (const el of controls) {
      expect(el.getBoundingClientRect().height, el.outerHTML).toBeGreaterThanOrEqual(24);
      expect(el.className.split(/\s+/), el.outerHTML).toContain('min-h-6');
      expect(el.className, el.outerHTML).not.toMatch(/pointer-coarse:/);
    }
  });
});

describe('how the records were checked', () => {
  it('does not fetch before the first open', async () => {
    const { fetchFn } = await setup();
    expect(fetchFn).not.toHaveBeenCalled();
    // Nothing of the parts is built before then either.
    expect(byId(ABOUT_ID.assumptions)).toBeNull();
  });

  it('reads Loading… until the fetch resolves, then lists the rules with counts', async () => {
    let resolve!: (r: Response) => void;
    const fetchFn = vi.fn(
      () =>
        new Promise<Response>((res) => {
          resolve = res;
        })
    );
    await setup({ fetchFn: fetchFn as unknown as typeof fetch });
    await openIt();
    await expect.poll(() => fetchFn.mock.calls.length).toBe(1);
    expect(fetchFn).toHaveBeenCalledWith(URL_);
    expect(byId('src-quality').textContent).toContain('Loading…');
    resolve(new Response(JSON.stringify(PROJECTS_JSON)));
    await expect.poll(() => byId('src-quality').querySelectorAll('tbody tr').length).toBe(3);
    const rows = [...byId('src-quality').querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim())
    );
    expect(rows[0][0]).toBe('A date outside 1970 to the snapshot day was treated as missing');
    expect(rows[0][1]).toContain(TIER_LABEL[4]);
    expect(rows[0][1]).toContain(NOT_SF_NOTE);
    expect(rows[0][2]).toBe('1 project');
    expect(rows[1][1]).toBe(TIER_LABEL[0]);
    expect(rows[1][2]).toBe('1 project');
    expect(rows[2][1]).toBe(TIER_LABEL[2]);
    expect(rows[2][2]).toBe('2 projects');
    expect(byId('src-quality').textContent).not.toContain('Loading…');
    expect(byId('src-quality').textContent).toContain(QUALITY_PARCEL_SENTENCE);
  });

  it('does not fetch again on a second open', async () => {
    const { fetchFn } = await setup();
    await openIt();
    await expect.poll(() => byId('src-quality').querySelectorAll('tbody tr').length).toBe(3);
    dialog().close();
    await openIt();
    await expect.poll(() => byId('src-quality').querySelectorAll('tbody tr').length).toBe(3);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('shows the failure copy and leaves the other sections intact', async () => {
    const fetchFn = vi.fn(() => Promise.reject(new Error('offline')));
    await setup({ fetchFn: fetchFn as unknown as typeof fetch });
    await openIt();
    await expect.poll(() => byId('src-quality')?.textContent).toContain(QUALITY_LOAD_FAILED);
    expect(byId('src-transition-discretionary-entitled')).not.toBeNull();
    expect(byId('src-initiation')).not.toBeNull();
  });

  it('the data checks load on the first open; a failure retries on the next', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(() => jsonResponse(PROJECTS_JSON));
    await setup({ fetchFn: fetchFn as unknown as typeof fetch });
    await openIt();
    await expect.poll(() => byId('src-quality')?.textContent).toContain(QUALITY_LOAD_FAILED);
    dialog().close();
    await openIt();
    await expect.poll(() => byId('src-quality').querySelectorAll('tbody tr').length).toBe(3);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('says no values were changed when no rule fired', async () => {
    const fetchFn = vi.fn(() => jsonResponse(PROJECTS_JSON_NO_RULES));
    await setup({ fetchFn: fetchFn as unknown as typeof fetch });
    await openIt();
    await expect.poll(() => byId('src-quality')?.textContent).toContain(QUALITY_EMPTY);
    expect(byId('src-quality').querySelector('table')).toBeNull();
    expect(byId('src-quality').textContent).toContain(QUALITY_PARCEL_SENTENCE);
  });
});

describe("today's market", () => {
  it('shows its heading and no research note under it', async () => {
    await setup({ sections: provenanceSections(liveMarketCalibration(), TIMELINE_SCORE) });
    await openIt();
    const section = byId('src-market');
    expect(section.textContent).toContain("Today's market");
    expect(section.textContent).not.toContain(NOT_SF_NOTE);
  });

  it('extended src-market and src-money render with links', async () => {
    const live = liveMarketCalibration();
    const terms = resolveTerms(undefined, { lossOnExit: 0.5, constructionRate: 0.07 });
    await setup({ sections: provenanceSections(live, TIMELINE_SCORE, terms) });
    await openIt();
    const slope = byId('src-market-slope');
    expect(slope.textContent).toContain("How strongly money moves a private project's odds");
    expect(slope.textContent).toContain(
      "Cross-checks, not used: the Controller's cost coefficient"
    );
    expect(slope.textContent).not.toContain(NOT_SF_NOTE);
    const slopeSrc = live.market!.slope.provenance.sources[0];
    expect(
      [...slope.querySelectorAll('a')]
        .find((a) => a.textContent?.includes(slopeSrc.label))
        ?.getAttribute('href')
    ).toBe(slopeSrc.url);
    expect(byId('src-market').textContent).toContain(
      "Not in force: today's public funding is modelled, so private starts run at their own level."
    );

    const money = byId('src-money');
    expect(money.querySelector('h4')?.textContent).toBe('Public money');
    expect(money.textContent).toContain(
      'If a funded project stops after construction starts, 50% spent or lent on it'
    );
    expect(money.textContent).toContain('Construction loan rate: your value (custom, not sourced)');
    expect(money.textContent).toContain('Loss on exit: your value (custom, not sourced)');
    const pipeline = byId('src-money-pipeline');
    expect(pipeline.textContent).toContain(PIPELINE_FUNDED.label);
    expect(pipeline.textContent).toContain(NOT_SF_NOTE);
    const expected = provenanceSections(live, TIMELINE_SCORE, terms).find(
      (s) => s.id === 'src-money'
    )!;
    let links = 0;
    for (const e of expected.entries) {
      const el = byId(e.id);
      for (const src of e.prov.sources) {
        const a = [...el.querySelectorAll('a')].find((x) => x.textContent?.includes(src.label));
        expect(a?.getAttribute('href'), e.id).toBe(src.url);
        links++;
      }
    }
    expect(links).toBeGreaterThan(5);
  });
});
