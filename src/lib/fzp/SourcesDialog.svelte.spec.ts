/// <reference types="@vitest/browser-playwright" />
import type { ComponentProps } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { fixtureCalibration } from './fixtures/calibration';
import { PROJECTS_JSON, PROJECTS_JSON_NO_RULES } from './fixtures/projects';
import { FIX_ASOF, TIMELINE_SCORE, TIMELINE_SCORE_NO_PHASING } from './fixtures/timeline-score';
import { formatDate } from './format';
import { TIER_LABEL } from './labels';
import {
  NOT_SF_NOTE,
  PERMIT_WINDOW_SENTENCE,
  PHASE_DELAY_SENTENCE,
  QUALITY_EMPTY,
  QUALITY_LOAD_FAILED,
  QUALITY_PARCEL_SENTENCE,
  TWIN_RESIZE_SENTENCE,
  UNENRICHED_SENTENCE,
  provenanceSections
} from './provenance';
import SourcesDialogHarness from './test/SourcesDialogHarness.svelte';

const cal = fixtureCalibration();
const URL_ = '/data/fixture-0/scenarios/fzp/projects.json';

type Props = ComponentProps<typeof SourcesDialogHarness>;

const jsonResponse = (body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

async function setup(over: Partial<Props> = {}) {
  await page.viewport(1280, 800);
  const fetchFn = vi.fn((_url: RequestInfo | URL) => jsonResponse(PROJECTS_JSON));
  const onopen = vi.fn();
  const props: Props = {
    calibration: cal,
    score: TIMELINE_SCORE,
    projectsUrl: URL_,
    asOf: FIX_ASOF,
    fetchFn: fetchFn as unknown as typeof fetch,
    onopen,
    ...over
  };
  const view = await render(SourcesDialogHarness, { props });
  return { fetchFn, onopen, view };
}

const dialog = () => document.querySelector('dialog') as HTMLDialogElement;
const byId = (id: string) => dialog().querySelector(`[id="${id}"]`) as HTMLElement;
const opener = () => page.getByRole('button', { name: 'Sources', exact: true });

async function openIt() {
  await opener().click();
  expect(dialog().open).toBe(true);
}

describe('opening', () => {
  it('shows a modal dialog with an h2 and an h3 per section, and calls onopen', async () => {
    const { onopen } = await setup();
    expect(dialog().open).toBe(false);
    await openIt();
    expect(dialog().matches(':modal')).toBe(true);
    expect(onopen).toHaveBeenCalledTimes(1);
    await expect
      .element(page.getByRole('heading', { level: 2, name: 'Where these numbers come from' }))
      .toBeVisible();
    const expected = provenanceSections(cal, TIMELINE_SCORE).map((s) => s.heading);
    const h3 = [...dialog().querySelectorAll('h3')].map((h) => h.textContent?.trim());
    expect(h3).toEqual([...expected, 'How the records were checked']);
  });

  it('traps Tab, closes on Escape and returns focus to the opener', async () => {
    await setup();
    (opener().element() as HTMLElement).focus();
    await openIt();
    expect(dialog().contains(document.activeElement)).toBe(true);
    const count = dialog().querySelectorAll('a[href], button').length;
    for (let i = 0; i < count + 2; i++) {
      await userEvent.tab();
      expect(dialog().contains(document.activeElement)).toBe(true);
    }
    await userEvent.keyboard('{Escape}');
    expect(dialog().open).toBe(false);
    expect(document.activeElement).toBe(opener().element());
  });

  it('wraps Tab over every focusable kind, a <summary> and a [tabindex] among them', async () => {
    await setup();
    await openIt();
    // Content a later section may add: a disclosure, and a focusable scroll region before it.
    const extra = document.createElement('div');
    extra.innerHTML =
      '<div tabindex="0" data-testid="scroller">Scroll</div><details><summary>More</summary></details>';
    dialog().append(extra);
    const close = dialog().querySelector('button')!;
    const summary = extra.querySelector('summary')!;
    const scroller = extra.querySelector('[tabindex]') as HTMLElement;
    try {
      close.focus();
      await userEvent.tab({ shift: true });
      expect(document.activeElement).toBe(summary);
      await userEvent.tab({ shift: true });
      expect(document.activeElement).toBe(scroller);
      summary.focus();
      await userEvent.tab();
      expect(document.activeElement).toBe(close);
    } finally {
      extra.remove();
    }
  });

  it('closes from its Close button', async () => {
    await setup();
    await openIt();
    await page.getByRole('button', { name: 'Close' }).click();
    expect(dialog().open).toBe(false);
  });

  it('scrolls the requested entry into view', async () => {
    await setup();
    await page.getByRole('button', { name: 'Open at entitled' }).click();
    expect(dialog().open).toBe(true);
    const box = dialog().getBoundingClientRect();
    const top = byId('src-transition-discretionary-entitled').getBoundingClientRect().top;
    expect(top).toBeGreaterThanOrEqual(box.top);
    expect(top).toBeLessThan(box.bottom);
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
    expect(dialog().getBoundingClientRect().width).toBe(375);
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
    const withoutPhasing = await setup({ score: TIMELINE_SCORE_NO_PHASING });
    await openIt();
    expect(byId('src-multiphase')).toBeNull();
    expect(byId('src-targets')).not.toBeNull();
    await withoutPhasing.view.unmount();
    await setup({ score: null });
    await openIt();
    expect(byId('src-actual')).toBeNull();
    expect(byId('src-targets')).toBeNull();
  });
});

describe('target sizes (spec §4.3)', () => {
  it('links and Close are at least 24 px tall and carry the 44 px coarse-pointer variant', async () => {
    await setup();
    await openIt();
    const controls = [...dialog().querySelectorAll<HTMLElement>('a[href], button')];
    expect(controls.length).toBeGreaterThan(5);
    for (const el of controls) {
      expect(el.getBoundingClientRect().height, el.outerHTML).toBeGreaterThanOrEqual(24);
      expect(
        el.className.includes('pointer-coarse:min-h-11') || el.className.includes('min-h-11'),
        el.outerHTML
      ).toBe(true);
    }
  });
});

describe('how the records were checked', () => {
  it('does not fetch before the first open', async () => {
    const { fetchFn } = await setup();
    expect(fetchFn).not.toHaveBeenCalled();
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
    expect(fetchFn).toHaveBeenCalledTimes(1);
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
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('shows the failure copy and leaves the other sections intact', async () => {
    const fetchFn = vi.fn(() => Promise.reject(new Error('offline')));
    await setup({ fetchFn: fetchFn as unknown as typeof fetch });
    await openIt();
    await expect.poll(() => byId('src-quality').textContent).toContain(QUALITY_LOAD_FAILED);
    expect(byId('src-transition-discretionary-entitled')).not.toBeNull();
    expect(byId('src-initiation')).not.toBeNull();
  });

  it('tries again on the next open after a failure', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(() => jsonResponse(PROJECTS_JSON));
    await setup({ fetchFn: fetchFn as unknown as typeof fetch });
    await openIt();
    await expect.poll(() => byId('src-quality').textContent).toContain(QUALITY_LOAD_FAILED);
    dialog().close();
    await openIt();
    await expect.poll(() => byId('src-quality').querySelectorAll('tbody tr').length).toBe(3);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('says no values were changed when no rule fired', async () => {
    const fetchFn = vi.fn(() => jsonResponse(PROJECTS_JSON_NO_RULES));
    await setup({ fetchFn: fetchFn as unknown as typeof fetch });
    await openIt();
    await expect.poll(() => byId('src-quality').textContent).toContain(QUALITY_EMPTY);
    expect(byId('src-quality').querySelector('table')).toBeNull();
    expect(byId('src-quality').textContent).toContain(QUALITY_PARCEL_SENTENCE);
  });
});
