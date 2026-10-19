/// <reference types="@vitest/browser-playwright" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { cdp, page } from 'vitest/browser';
import '../../routes/layout.css';
import { TIMELINE_LEGEND, timelineTokenCss } from '$lib/map/palette';
import { announcement } from './score-view';
import {
  FIX_ASOF,
  TIMELINE_SCORE,
  TIMELINE_SCORE_NO_PHASING,
  TIMELINE_SCORE_R0
} from './fixtures/timeline-score';
import FzpScoreboard from './FzpScoreboard.svelte';
import { scoreAt } from './score-view';
import { HORIZON, dayFromUtc, monthIndex } from './time';

/** Index 53 of the fixture: 2031-03-15. */
const DAY = dayFromUtc(2031, 3, 15);
const INTRO =
  "One possible future for San Francisco under the Family Zoning Plan. It starts from every real project in the pipeline today and adds new ones at the rates the city's own records show. It is a simulation, not a forecast.";

type Overrides = Partial<{
  score: typeof TIMELINE_SCORE | null;
  day: number;
  playing: boolean;
  bandRuns: number;
  bandRunsTotal: number;
  seed: number | null;
  representative: boolean;
  onrepresentative: () => void;
  onsources: () => void;
  onsheetchange: (open: boolean, heightPx: number) => void;
}>;

const props = (over: Overrides = {}) => ({
  score: TIMELINE_SCORE,
  day: DAY,
  asOf: FIX_ASOF,
  horizon: HORIZON,
  playing: false,
  bandRuns: 101,
  bandRunsTotal: 101,
  seed: 7,
  representative: true,
  datasetVersion: 'fixture-0',
  builtAt: '2026-10-10T12:00:00Z',
  onrepresentative: vi.fn(),
  onsources: vi.fn(),
  ...over
});

const scorebarH = () =>
  getComputedStyle(document.documentElement).getPropertyValue('--scorebar-h').trim();
const live = () => page.getByTestId('fzp-score-live').element().textContent;

async function scheme(value: 'light' | 'dark') {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value }]
  });
}

afterEach(async () => {
  vi.useRealTimers();
  await scheme('light');
});

describe('region and intro', () => {
  it('is the Simulation scoreboard with the badge and intro', async () => {
    await page.viewport(1024, 768);
    await render(FzpScoreboard, { props: props() });
    await expect
      .element(page.getByRole('region', { name: 'Simulation scoreboard' }))
      .toBeInTheDocument();
    await expect.element(page.getByTestId('fzp-badge')).toHaveTextContent('Simulation');
    await expect.element(page.getByText(INTRO)).toBeInTheDocument();
  });

  it('before the first timeline: only the badge, intro and a loading line', async () => {
    await page.viewport(1024, 768);
    await render(FzpScoreboard, { props: props({ score: null }) });
    await expect.element(page.getByText('Loading the simulation…').first()).toBeVisible();
    await expect.element(page.getByText(INTRO)).toBeInTheDocument();
    expect(document.querySelector('[data-testid="fzp-net"]')).toBeNull();
    expect(document.querySelector('svg[role="img"]')).toBeNull();
    expect(document.querySelector('.sfh-fzp-legend')).toBeNull();
    expect(document.querySelector('[role="meter"]')).toBeNull();
  });
});

describe('headline and split', () => {
  it('shows the total and the three-way split at the scrubbed month', async () => {
    await page.viewport(1024, 768);
    await render(FzpScoreboard, { props: props() });
    const i = monthIndex(DAY, TIMELINE_SCORE.months[0], TIMELINE_SCORE.months.length);
    expect(i).toBe(53);
    await expect.element(page.getByTestId('fzp-net')).toHaveTextContent('17,300');
    await expect.element(page.getByText('net new homes since Jun 30, 2022')).toBeVisible();
    const row = (label: string) =>
      page.getByText(label, { exact: true }).element().parentElement!.textContent!;
    expect(row('Actually completed, to Oct 16, 2026')).toContain('12,000');
    expect(row("Simulated, from today's pipeline")).toContain('3,180');
    expect(row("Simulated, new projects not yet in today's pipeline")).toContain('2,120');
  });
});

describe('bands', () => {
  it('marks both band lines provisional while runs are outstanding, then clears', async () => {
    await page.viewport(1024, 768);
    const screen = await render(FzpScoreboard, {
      props: props({ bandRuns: 40, bandRunsTotal: 101 })
    });
    const total = page.getByText(/^In 8 of 10 simulated futures:/);
    const plan = page.getByText(/^In 8 of 10 futures:/);
    await expect
      .element(total)
      .toHaveTextContent('In 8 of 10 simulated futures: 16,770–17,830 (still calculating)');
    await expect
      .element(plan)
      .toHaveTextContent('In 8 of 10 futures: 1,240–1,340 (still calculating)');
    await expect.element(total).toHaveAttribute('aria-busy', 'true');
    await expect.element(plan).toHaveAttribute('aria-busy', 'true');

    await screen.rerender(props({ bandRuns: 101, bandRunsTotal: 101 }));
    await expect.element(total).toHaveTextContent('In 8 of 10 simulated futures: 16,770–17,830');
    await expect.element(total).not.toHaveTextContent('still calculating');
    await expect.element(plan).not.toHaveTextContent('still calculating');
    await expect.element(total).not.toHaveAttribute('aria-busy', 'true');
    await expect.element(plan).not.toHaveAttribute('aria-busy', 'true');
  });
});

describe('what the plan added', () => {
  it('shows the plan-effect rows, the band without baseline and the twin paragraph', async () => {
    await page.viewport(1024, 768);
    await render(FzpScoreboard, { props: props() });
    await expect.element(page.getByText('What the plan added')).toBeVisible();
    const row = (label: string) =>
      page.getByText(label, { exact: true }).element().parentElement!.textContent!;
    expect(row('Homes completed because of the plan')).toContain('1,290');
    expect(row('Homes approved because of the plan')).toContain('2,185');
    await expect.element(page.getByText('In 8 of 10 futures: 1,240–1,340')).toBeInTheDocument();
    await expect
      .element(
        page.getByText(
          "To see what the plan itself does, each future is run twice: once with the Family Zoning Plan, and once as the same city simulated under the old zoning, with the same luck. The difference between the two is the plan's effect. Some homes would have been built anyway; they are not counted here."
        )
      )
      .toBeInTheDocument();
    expect(
      page.getByText('What the plan added').element().closest('section')!.getAttribute('aria-busy')
    ).toBeNull();
  });

  it('plan effect not yet computed: calculating rows, busy sub-section, twin paragraph kept', async () => {
    await page.viewport(1024, 768);
    await render(FzpScoreboard, { props: props({ score: TIMELINE_SCORE_R0 }) });
    const row = (label: string) =>
      page.getByText(label, { exact: true }).element().parentElement!.textContent!;
    expect(row('Homes completed because of the plan')).toContain('calculating…');
    expect(row('Homes approved because of the plan')).toContain('calculating…');
    const section = page.getByText('What the plan added').element().closest('section')!;
    expect(section.getAttribute('aria-busy')).toBe('true');
    await expect.element(page.getByText('Range: calculating…')).toBeInTheDocument();
    expect(section.textContent).toContain('each future is run twice');
    // the total band is unaffected
    await expect.element(page.getByText(/^In 8 of 10 simulated futures:/)).toBeVisible();
  });
});

describe('targets and progress', () => {
  it('renders RHNA then RHNA + buffer, each with its deadline fraction', async () => {
    await page.viewport(1024, 768);
    await render(FzpScoreboard, { props: props() });
    const meters = page.getByRole('meter').elements();
    expect(meters.map((m) => m.getAttribute('aria-label'))).toEqual([
      TIMELINE_SCORE.targets[0].target.label,
      TIMELINE_SCORE.targets[1].target.label
    ]);
    const lines = document.body.textContent!.match(/At the deadline \(Jan 31, 2031\): [^A]*%/g);
    expect(lines?.map((l) => l.trim())).toEqual([
      'At the deadline (Jan 31, 2031): 20%',
      'At the deadline (Jan 31, 2031): 18%'
    ]);
  });

  it('lists the in-progress total and one row per stage, then the stopped line', async () => {
    await page.viewport(1024, 768);
    await render(FzpScoreboard, { props: props() });
    await expect
      .element(page.getByText('Homes in projects still in progress: 210'))
      .toBeInTheDocument();
    const rows = [...page.getByTestId('fzp-stages').element().querySelectorAll('div')].map((d) =>
      d.textContent!.replace(/\s+/g, ' ').trim()
    );
    expect(rows).toEqual([
      'Pre-application 10',
      'In Planning review 20',
      'Approved, building permit not yet filed 30',
      'Building permit review 40',
      'Permit issued, not started 50',
      'Under construction 60'
    ]);
    await expect
      .element(page.getByText('Proposed homes in projects that stopped since October 2026: 265'))
      .toBeInTheDocument();
  });
});

describe('future line', () => {
  it('representative: marks it and offers no way back', async () => {
    await page.viewport(1024, 768);
    await render(FzpScoreboard, { props: props({ seed: 7, representative: true }) });
    await expect.element(page.getByText('This future: #7 (representative)')).toBeVisible();
    expect(document.body.textContent).not.toContain('Back to the representative future');
  });

  it('another future: no suffix, and a button back', async () => {
    await page.viewport(1024, 768);
    const onrepresentative = vi.fn();
    await render(FzpScoreboard, {
      props: props({ seed: 7, representative: false, onrepresentative })
    });
    await expect.element(page.getByText('This future: #7')).toBeVisible();
    expect(page.getByText('This future: #7').element().textContent).not.toContain('representative');
    await page.getByRole('button', { name: 'Back to the representative future' }).click();
    expect(onrepresentative).toHaveBeenCalledOnce();
  });

  it('opens the sources dialog through its callback', async () => {
    await page.viewport(1024, 768);
    const onsources = vi.fn();
    await render(FzpScoreboard, { props: props({ onsources }) });
    await page.getByRole('button', { name: 'Where these numbers come from' }).click();
    expect(onsources).toHaveBeenCalledOnce();
  });
});

describe('map key', () => {
  it('has one row per legend entry, verbatim, and the fzp-mode bar-length line', async () => {
    await page.viewport(1024, 768);
    await render(FzpScoreboard, { props: props() });
    const key = document.querySelector('details.sfh-fzp-legend') as HTMLDetailsElement;
    expect(key.open).toBe(true);
    const rows = [...key.querySelectorAll('[data-legend]')];
    expect(rows.map((r) => r.getAttribute('data-legend'))).toEqual(
      TIMELINE_LEGEND.map((e) => e.id)
    );
    for (const e of TIMELINE_LEGEND) {
      const row = key.querySelector(`[data-legend="${e.id}"]`)!;
      expect(row.textContent!.trim()).toBe(e.label);
    }
    expect(page.getByText('Bar colour', { exact: false }).elements()).toHaveLength(1);
    expect(page.getByText('Bar length: progress through the stages.').elements()).toHaveLength(1);
  });

  it('injects the token CSS into <head> once', async () => {
    await page.viewport(1024, 768);
    await render(FzpScoreboard, { props: props() });
    const css = timelineTokenCss('.sfh-fzp-legend');
    const styles = [...document.head.querySelectorAll('style')].filter(
      (s) => s.textContent === css
    );
    expect(styles).toHaveLength(1);
  });

  it('resolves every legend token under light and dark', async () => {
    await page.viewport(1024, 768);
    await render(FzpScoreboard, { props: props() });
    const read = (id: string, token: string) =>
      getComputedStyle(document.querySelector(`[data-swatch="${id}"]`)!)
        .getPropertyValue(`--map-${token}`)
        .trim();
    const tokens = TIMELINE_LEGEND.flatMap((e) => e.tokens.map((t) => [e.id, t] as const));
    expect(tokens.length).toBeGreaterThan(10);

    await scheme('light');
    const light = tokens.map(([id, t]) => read(id, t));
    await scheme('dark');
    await expect.poll(() => tokens.map(([id, t]) => read(id, t))).not.toEqual(light);
    const dark = tokens.map(([id, t]) => read(id, t));
    tokens.forEach(([id, t], k) => {
      expect(light[k], `${t} light`).not.toBe('');
      expect(dark[k], `${t} dark`).not.toBe('');
      expect(dark[k], `${t} differs by theme`).not.toBe(light[k]);
      expect(id).toBeTruthy();
    });
  });
});

describe('footnote', () => {
  it('names the data, the build, the as-of date and links Sources, then the phasing sentence', async () => {
    await page.viewport(1024, 768);
    await render(FzpScoreboard, { props: props() });
    await expect
      .element(page.getByText('Data fixture-0 · built 2026-10-10 · as of Oct 16, 2026 · Sources'))
      .toBeVisible();
    expect(page.getByRole('link', { name: 'Sources' }).element().getAttribute('href')).toBe(
      '/attribution'
    );
    await expect
      .element(
        page.getByText(
          'Multi-phase projects: 5 phases scheduled from published plans, 3 estimated from past projects; 2 projects without phase data are simulated as one project each: 1 drawn as one footprint on a free lot, 1 counted in the score but not drawn.'
        )
      )
      .toBeVisible();
  });

  it('omits the phasing sentence when there are no master plans', async () => {
    await page.viewport(1024, 768);
    await render(FzpScoreboard, { props: props({ score: TIMELINE_SCORE_NO_PHASING }) });
    await expect.element(page.getByText(/^Data fixture-0/)).toBeVisible();
    expect(document.body.textContent).not.toContain('Multi-phase projects');
  });
});

describe('live region', () => {
  it('is silent while playing, then speaks 1 s after playback pauses', async () => {
    vi.useFakeTimers();
    await page.viewport(1024, 768);
    const screen = await render(FzpScoreboard, { props: props({ playing: true }) });
    const day2 = dayFromUtc(2031, 4, 2);
    await screen.rerender(props({ playing: true, day: day2 }));
    vi.advanceTimersByTime(3000);
    expect(live()).toBe('');

    await screen.rerender(props({ playing: false, day: day2 }));
    vi.advanceTimersByTime(900);
    expect(live()).toBe('');
    vi.advanceTimersByTime(200);
    const expected = announcement(day2, scoreAt(TIMELINE_SCORE, 54));
    await expect.poll(live).toBe(expected);
    expect(expected).toBe('April 2031: 17,400 net new homes in this simulation, 21% of RHNA.');
  });

  it('does not announce the state it loaded in', async () => {
    vi.useFakeTimers();
    await page.viewport(1024, 768);
    await render(FzpScoreboard, { props: props() });
    vi.advanceTimersByTime(3000);
    expect(live()).toBe('');
  });
});

describe('375 px', () => {
  it('shows the collapsed bar and sets --scorebar-h below 768 px only', async () => {
    await page.viewport(375, 812);
    const screen = await render(FzpScoreboard, { props: props() });
    const bar = page.getByRole('button', { name: /net new homes/ });
    await expect
      .element(page.getByTestId('fzp-scorebar-text'))
      .toHaveTextContent('17,300 net new homes · 21% of RHNA');
    await expect.element(bar).toHaveTextContent('Simulation');
    expect(bar.element().getBoundingClientRect().height).toBe(56);
    expect(scorebarH()).toBe('56px');
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
    await screen.unmount();

    await page.viewport(1024, 768);
    await render(FzpScoreboard, { props: props() });
    expect(scorebarH()).toBe('');
  });

  it('opens the sheet with focus on Close and returns focus to the bar button', async () => {
    await page.viewport(375, 812);
    await render(FzpScoreboard, { props: props() });
    const bar = page.getByRole('button', { name: /net new homes/ });
    await expect.element(bar).toHaveAttribute('aria-expanded', 'false');
    await bar.click();
    await expect.element(bar).toHaveAttribute('aria-expanded', 'true');
    const close = page.getByRole('button', { name: 'Close' });
    await expect.element(close).toHaveFocus();
    await close.click();
    await expect.element(bar).toHaveFocus();
    await expect.element(bar).toHaveAttribute('aria-expanded', 'false');
  });

  it('sheet closes when the viewport widens', async () => {
    await page.viewport(375, 812);
    const onsheetchange = vi.fn();
    await render(FzpScoreboard, { props: props({ onsheetchange }) });
    await page.getByRole('button', { name: /net new homes/ }).click();
    await expect
      .element(page.getByRole('group', { name: 'Simulation scoreboard details' }))
      .toBeVisible();
    await expect.poll(() => onsheetchange.mock.calls.at(-1)?.[0]).toBe(true);
    expect(onsheetchange.mock.calls.at(-1)![1]).toBeGreaterThan(56);

    await page.viewport(1024, 768);
    await expect
      .element(page.getByRole('group', { name: 'Simulation scoreboard details' }))
      .not.toBeInTheDocument();
    await expect.poll(() => onsheetchange.mock.calls.at(-1)).toEqual([false, 0]);
  });

  it('the sheet map key starts closed', async () => {
    await page.viewport(375, 812);
    await render(FzpScoreboard, { props: props() });
    await page.getByRole('button', { name: /net new homes/ }).click();
    const sheet = document.querySelector('[role="group"]')!;
    expect((sheet.querySelector('details.sfh-fzp-legend') as HTMLDetailsElement).open).toBe(false);
  });
});
