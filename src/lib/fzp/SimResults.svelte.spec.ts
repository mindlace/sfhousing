/// <reference types="@vitest/browser-playwright" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { cdp, page } from 'vitest/browser';
import '../../routes/layout.css';
import { TIMELINE_LEGEND, timelineTokenCss } from '$lib/map/palette';
import {
  FIX_ASOF,
  FIX_HORIZON,
  TIMELINE_SCORE,
  TIMELINE_SCORE_NO_PHASING,
  TIMELINE_SCORE_R0
} from './fixtures/timeline-score';
import { scoreCopy } from '$lib/sim-page/policy';
import { DEFAULT_LEVERS } from '$lib/sim/levers/types';
import type { LeverCapacity } from '$lib/sim/levers/resolve';
import SimResults from './SimResults.svelte';
import { formatPercent } from '$lib/scoreboard';
import { scoreAt } from './score-view';
import { dayFromUtc, monthIndex } from './time';
import { MONEY_LAST, MONEY_SCORE } from './fixtures/money';
import { fixtureCalibration } from './fixtures/calibration';
import { formatDollars, formatMonthYear } from './format';
import { marketSentence } from './market-view';
import {
  affordableLine,
  allLine,
  cityLine,
  fundedLine,
  marketText,
  moneyAt,
  tiersAt
} from './money-view';
import { formatCount } from '$lib/scoreboard/format';
import { resolveTerms } from '$lib/sim/finance';
import {
  MONEY_SOURCES,
  TIER_SOURCES,
  tierBaselineLabel,
  type Money
} from '$lib/sim/scenario/finance-score';
import { MARKET_FUNDING_SENTENCE } from '$lib/sim-page/funding-copy';
import type { ResolvedTerms } from '$lib/timelapse/types';

/** Index 53 of the fixture: 2031-03-15. */
const DAY = dayFromUtc(2031, 3, 15);
const INTRO =
  "One possible future for San Francisco under the Family Zoning Plan. It starts from every real project in the pipeline today and adds new ones at the rates the city's own records show. It is a simulation, not a forecast.";

type Overrides = Partial<{
  score: typeof TIMELINE_SCORE | null;
  day: number;
  highWater: number;
  bandRuns: number;
  bandRunsTotal: number;
  seed: number | null;
  representative: boolean;
  canReroll: boolean;
  onrepresentative: () => void;
  onsources: () => void;
  copy: ReturnType<typeof scoreCopy>;
  capacity: LeverCapacity | null;
  market: string | null;
  stale: boolean;
  pending: boolean;
  terms: ResolvedTerms;
  uncapped: ReadonlySet<string>;
}>;

const props = (over: Overrides = {}) => {
  const p = {
    score: TIMELINE_SCORE as typeof TIMELINE_SCORE | null,
    day: DAY,
    asOf: FIX_ASOF,
    horizon: FIX_HORIZON,
    highWater: FIX_HORIZON,
    bandRuns: 101,
    bandRunsTotal: 101,
    seed: 7,
    representative: true,
    canReroll: true,
    datasetVersion: 'fixture-0',
    builtAt: '2026-10-10T12:00:00Z',
    onrepresentative: vi.fn(),
    onsources: vi.fn(),
    ...over
  };
  const sc = p.score;
  const at = sc ? scoreAt(sc, monthIndex(p.day, sc.months[0], sc.months.length)) : null;
  return { ...p, at };
};

async function scheme(value: 'light' | 'dark') {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value }]
  });
}

afterEach(async () => {
  vi.useRealTimers();
  await scheme('light');
});

/** The closed "Sources" disclosure: the details that moved behind it. */
const sources = () =>
  document.querySelector('details[data-testid="fzp-sources"]') as HTMLDetailsElement;
const openSources = () => {
  sources().open = true;
};

describe('intro and loading', () => {
  it('has no badge, and the one-possible-future paragraph is in Sources', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, { props: props() });
    expect(document.querySelector('[data-testid="fzp-badge"]')).toBeNull();
    const intro = page.getByText(INTRO).element();
    expect(sources().contains(intro)).toBe(true);
  });

  it('before the first timeline: only the intro and a loading line', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, { props: props({ score: null }) });
    await expect.element(page.getByText('Loading the simulation…').first()).toBeVisible();
    expect(document.querySelector('[data-testid="fzp-net"]')).toBeNull();
    expect(document.querySelector('svg[role="img"]')).toBeNull();
    expect(document.querySelector('.sfh-fzp-legend')).toBeNull();
    expect(document.querySelector('[role="meter"]')).toBeNull();
  });
});

describe('layout', () => {
  it('orders headline, what the plan added, chart, targets, pipeline, then Sources', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, { props: props() });
    const before = (a: Element, b: Element) =>
      expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const els = [
      page.getByTestId('fzp-net').element(),
      page.getByText('What the plan added').element(),
      document.querySelector('[data-testid="fzp-chart"] svg')!,
      page.getByRole('meter').first().element(),
      page.getByTestId('fzp-stages').element(),
      sources().querySelector('summary')!
    ];
    for (let k = 0; k < els.length - 1; k++) before(els[k], els[k + 1]);
  });

  it('Sources is closed by default and holds where the numbers come from', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, { props: props() });
    const d = sources();
    expect(d.open).toBe(false);
    expect(d.querySelector('summary')!.textContent!.trim()).toBe('Sources');
    expect(d.textContent).toContain('Where these numbers come from');
  });

  it('puts the since-date and the built-by-today line under the headline', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, { props: props() });
    await expect.element(page.getByText('homes added since Jun 2022')).toBeVisible();
    await expect.element(page.getByText('of which 12,000 built by today')).toBeVisible();
  });
});

describe('headline and pipeline', () => {
  it('shows the total at the scrubbed month and where it comes from', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, { props: props() });
    const i = monthIndex(DAY, TIMELINE_SCORE.months[0], TIMELINE_SCORE.months.length);
    expect(i).toBe(53);
    await expect.element(page.getByTestId('fzp-net')).toHaveTextContent('17,300');
    const row = (label: string) =>
      page.getByText(label, { exact: true }).element().parentElement!.textContent!;
    expect(row("Simulated, from today's pipeline")).toContain('3,180');
    expect(row("Simulated, new projects not yet in today's pipeline")).toContain('2,120');
  });
});

describe('bands', () => {
  it('marks both band lines provisional while runs are outstanding, then clears', async () => {
    await page.viewport(1024, 768);
    const screen = await render(SimResults, {
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
    await render(SimResults, { props: props() });
    await expect.element(page.getByText('What the plan added')).toBeVisible();
    const row = (label: string) =>
      page.getByText(label, { exact: true }).element().parentElement!.textContent!;
    expect(row('Homes completed because of the plan')).toContain('1,290');
    expect(row('Homes approved because of the plan')).toContain('2,185');
    await expect.element(page.getByText('In 8 of 10 futures: 1,240–1,340')).toBeInTheDocument();
    expect(sources().textContent).toContain('each future is run twice');
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
    await render(SimResults, { props: props({ score: TIMELINE_SCORE_R0 }) });
    const row = (label: string) =>
      page.getByText(label, { exact: true }).element().parentElement!.textContent!;
    expect(row('Homes completed because of the plan')).toContain('calculating…');
    expect(row('Homes approved because of the plan')).toContain('calculating…');
    const section = page.getByText('What the plan added').element().closest('section')!;
    expect(section.getAttribute('aria-busy')).toBe('true');
    await expect.element(page.getByText('Range: calculating…')).toBeInTheDocument();
    expect(sources().textContent).toContain('each future is run twice');
    // the total band is unaffected
    openSources();
    await expect.element(page.getByText(/^In 8 of 10 simulated futures:/)).toBeVisible();
  });
});

describe('score copy (/sim)', () => {
  it('names your policy and the Family Zoning Plan as written for a customised policy', async () => {
    await page.viewport(1024, 768);
    const copy = scoreCopy({ ...DEFAULT_LEVERS, compare: 'fzp' });
    await render(SimResults, { props: props({ copy }) });
    await expect.element(page.getByText('What your policy added')).toBeVisible();
    await expect.element(page.getByText('What the plan added')).not.toBeInTheDocument();
    await expect
      .element(page.getByText(/^One possible future for San Francisco under your policy\./))
      .toBeInTheDocument();
    const row = (label: string) =>
      page.getByText(label, { exact: true }).element().parentElement!.textContent!;
    expect(row('Homes completed because of your policy')).toContain('1,290');
    expect(row('Homes approved because of your policy')).toContain('2,185');
    await expect
      .element(
        page.getByText(
          "To see what your policy itself does, each future is run twice: once with your policy, and once as the same city simulated under the Family Zoning Plan as written, with the same luck. The difference between the two is your policy's effect. Some homes would have been built anyway; they are not counted here."
        )
      )
      .toBeInTheDocument();
  });

  it('names the comparison in the added section', async () => {
    await page.viewport(1024, 768);
    const screen = await render(SimResults, { props: props({ copy: scoreCopy(null) }) });
    const first = () => page.getByText('What the plan added').element().closest('section')!;
    expect(first().querySelector('p')!.textContent!.trim()).toBe('FZP added 1,290 homes vs no FZP');
    await screen.rerender(props({ copy: scoreCopy({ ...DEFAULT_LEVERS, compare: 'fzp' }) }));
    const mine = page.getByText('What your policy added').element().closest('section')!;
    expect(mine.querySelector('p')!.textContent!.trim()).toBe(
      'Your policy added 1,290 homes vs FZP'
    );
    await screen.rerender(props({ score: TIMELINE_SCORE_R0, copy: scoreCopy(null) }));
    expect(first().getAttribute('aria-busy')).toBe('true');
    expect(first().querySelector('p')!.textContent!.trim()).toBe('FZP vs no FZP: calculating…');
  });

  it('keeps the Family Zoning Plan text for the FZP copy', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, { props: props({ copy: scoreCopy(null) }) });
    await expect.element(page.getByText('What the plan added')).toBeVisible();
    await expect.element(page.getByText(INTRO)).toBeInTheDocument();
  });

  it('the default levers get the FZP copy', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, { props: props({ copy: scoreCopy(DEFAULT_LEVERS) }) });
    await expect.element(page.getByText('What the plan added')).toBeVisible();
  });
});

describe('protections cost (/sim)', () => {
  const PROT = /lots protected:/;

  it('names the protected lots and the zoned capacity they cost', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, {
      props: props({
        capacity: { plan: 900, withoutProtections: 1000, protectedLots: 12 }
      })
    });
    const line = page.getByText(PROT);
    await expect
      .element(line)
      .toHaveTextContent('12 lots protected: 100 fewer homes of zoned capacity');
    // Not live-announced: no live region on or around the line.
    expect(line.element().closest('[aria-live], [role="status"], [role="alert"]')).toBeNull();
  });

  it('formats large numbers with formatCount', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, {
      props: props({
        capacity: { plan: 0, withoutProtections: 12345, protectedLots: 1200 }
      })
    });
    await expect
      .element(page.getByText(PROT))
      .toHaveTextContent('1,200 lots protected: 12,345 fewer homes of zoned capacity');
  });

  it('reads in the singular for one lot and one home', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, {
      props: props({
        capacity: { plan: 900, withoutProtections: 901, protectedLots: 1 }
      })
    });
    await expect
      .element(page.getByText(/lot protected:/))
      .toHaveTextContent('1 lot protected: 1 fewer home of zoned capacity');
  });

  it('shows no line with no protected lots or no capacity', async () => {
    await page.viewport(1024, 768);
    const r = await render(SimResults, {
      props: props({
        capacity: { plan: 900, withoutProtections: 900, protectedLots: 0 }
      })
    });
    await expect.element(page.getByTestId('fzp-net')).toBeVisible();
    expect(document.body.textContent).not.toMatch(PROT);
    await r.rerender({ capacity: null });
    expect(document.body.textContent).not.toMatch(PROT);
  });
});

describe('targets and progress', () => {
  it('renders RHNA then RHNA + buffer, each with its deadline fraction', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, { props: props() });
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

  it('hides the deadline line until the high-water mark reaches the deadline month', async () => {
    await page.viewport(1024, 768);
    const before = await render(SimResults, {
      props: props({ day: dayFromUtc(2030, 6, 1), highWater: dayFromUtc(2030, 12, 31) })
    });
    expect(document.body.textContent).not.toContain('At the deadline');
    await before.unmount();

    await render(SimResults, {
      props: props({ day: dayFromUtc(2030, 6, 1), highWater: dayFromUtc(2031, 1, 1) })
    });
    const at = scoreAt(
      TIMELINE_SCORE,
      monthIndex(dayFromUtc(2030, 6, 1), TIMELINE_SCORE.months[0], TIMELINE_SCORE.months.length)
    );
    const lines = document.body.textContent!.match(/At the deadline \(Jan 31, 2031\): [^A]*%/g);
    expect(lines?.map((l) => l.trim())).toEqual(
      at.targets.map((t) => `At the deadline (Jan 31, 2031): ${formatPercent(t.atDeadline)}`)
    );
  });

  it('lists the in-progress total and one row per stage, then the stopped line', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, { props: props() });
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
    await render(SimResults, { props: props({ seed: 7, representative: true }) });
    openSources();
    await expect.element(page.getByText('This future: #7 (representative)')).toBeVisible();
    expect(document.body.textContent).not.toContain('Back to the representative future');
  });

  it('another future: no suffix, and a button back', async () => {
    await page.viewport(1024, 768);
    const onrepresentative = vi.fn();
    await render(SimResults, {
      props: props({ seed: 7, representative: false, onrepresentative })
    });
    openSources();
    await expect.element(page.getByText('This future: #7')).toBeVisible();
    expect(page.getByText('This future: #7').element().textContent).not.toContain('representative');
    await page.getByRole('button', { name: 'Back to the representative future' }).click();
    expect(onrepresentative).toHaveBeenCalledOnce();
  });

  it('the way back is disabled, and inert, while a future cannot be asked for', async () => {
    await page.viewport(1280, 800);
    const onrepresentative = vi.fn();
    await render(SimResults, {
      props: props({ seed: 7, representative: false, canReroll: false, onrepresentative })
    });
    openSources();
    const back = page.getByRole('button', { name: 'Back to the representative future' });
    await expect.element(back).toHaveAttribute('aria-disabled', 'true');
    (back.element() as HTMLElement).click();
    expect(onrepresentative).not.toHaveBeenCalled();
  });

  it('opens the sources dialog through its callback', async () => {
    await page.viewport(1024, 768);
    const onsources = vi.fn();
    await render(SimResults, { props: props({ onsources }) });
    openSources();
    await page.getByRole('button', { name: 'Where these numbers come from' }).click();
    expect(onsources).toHaveBeenCalledOnce();
  });
});

describe('map key', () => {
  it('has one row per legend entry, verbatim, and the fzp-mode bar-length line', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, { props: props() });
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
    await render(SimResults, { props: props() });
    const css = timelineTokenCss('.sfh-fzp-legend');
    const styles = [...document.head.querySelectorAll('style')].filter(
      (s) => s.textContent === css
    );
    expect(styles).toHaveLength(1);
  });

  it('resolves every legend token under light and dark', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, { props: props() });
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
  it('names the data, the build, the as-of date and links Data sources, then the phasing sentence', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, { props: props() });
    openSources();
    await expect
      .element(
        page.getByText('Data fixture-0 · built 2026-10-10 · as of Oct 16, 2026 · Data sources')
      )
      .toBeVisible();
    const link = page.getByRole('link', { name: 'Data sources', exact: true });
    expect(link.element().getAttribute('href')).toBe('/attribution');
    // Only the disclosure is named "Sources": the link inside it has its own name.
    expect(page.getByRole('link', { name: 'Sources', exact: true }).elements()).toEqual([]);
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
    await render(SimResults, { props: props({ score: TIMELINE_SCORE_NO_PHASING }) });
    openSources();
    await expect.element(page.getByText(/^Data fixture-0/)).toBeVisible();
    expect(document.body.textContent).not.toContain('Multi-phase projects');
  });
});

describe('375 px', () => {
  it('the map key starts closed on a phone', async () => {
    await page.viewport(375, 812);
    await render(SimResults, { props: props() });
    const key = document.querySelector('details.sfh-fzp-legend') as HTMLDetailsElement;
    expect(key.open).toBe(false);
  });
});

describe('target size on a fine pointer (SC 2.5.8)', () => {
  const MIN = 24;
  const expectTarget = (el: Element, name: string) => {
    const r = el.getBoundingClientRect();
    expect(r.width, `${name} width`).toBeGreaterThanOrEqual(MIN);
    expect(r.height, `${name} height`).toBeGreaterThanOrEqual(MIN);
  };

  it('every control in the desktop panel is at least 24x24', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, { props: props({ representative: false }) });
    openSources();
    expectTarget(document.querySelector('.sfh-fzp-legend > summary')!, 'Map key summary');
    expectTarget(
      document.querySelector('[data-testid="fzp-chart"] details > summary')!,
      'Show as table summary'
    );
    expectTarget(
      page.getByRole('button', { name: 'Back to the representative future' }).element(),
      'Back to the representative future'
    );
    expectTarget(
      page.getByRole('button', { name: 'Where these numbers come from' }).element(),
      'Where these numbers come from'
    );
    expectTarget(
      page.getByRole('link', { name: 'Data sources', exact: true }).element(),
      'Data sources link'
    );
  });

  it('summaries and the Data sources link carry the 44 px coarse-pointer variant', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, { props: props() });
    openSources();
    for (const el of [
      document.querySelector('.sfh-fzp-legend > summary')!,
      document.querySelector('[data-testid="fzp-chart"] details > summary')!,
      page.getByRole('link', { name: 'Data sources', exact: true }).element()
    ]) {
      expect(el.classList.contains('pointer-coarse:min-h-11'), el.outerHTML).toBe(true);
    }
  });
});

describe('the market paragraph', () => {
  it('sits right after the first paragraph of Sources', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, { props: props({ market: 'X sentence' }) });
    openSources();
    const m = sources().querySelector('[data-testid="fzp-market"]')!;
    expect(m.textContent).toBe('X sentence');
    expect(sources().querySelector('p')!.nextElementSibling).toBe(m);
  });

  it.each([undefined, null])('renders nothing for %s', async (market) => {
    await page.viewport(1024, 768);
    await render(SimResults, { props: props({ market }) });
    openSources();
    expect(sources().querySelector('[data-testid="fzp-market"]')).toBeNull();
  });
});

describe('public money and income tiers (funding-ui 4.11)', () => {
  const money = MONEY_SCORE.money as Money;
  const tiers = MONEY_SCORE.tiers!;
  /** The 15th of month `i` of the fixture. */
  const dayOf = (i: number) => MONEY_SCORE.months[i] + 14;
  const at = (i: number, over: Overrides = {}) =>
    props({ score: MONEY_SCORE, day: dayOf(i), highWater: dayOf(i), ...over });
  const el = (id: string) => document.querySelector(`[data-testid="${id}"]`);
  const open = async (name: string) => {
    await page.getByRole('button', { name }).click();
  };
  const before = (a: Element, b: Element) =>
    expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  it('two blocks in the order of 4.11', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, { props: at(MONEY_LAST) });
    const els = [
      page.getByTestId('fzp-net').element(),
      page.getByText('What the plan added').element(),
      el('fzp-money')!,
      document.querySelector('[data-testid="fzp-chart"] svg')!,
      page.getByRole('meter').first().element(),
      el('fzp-tiers')!,
      page.getByTestId('fzp-stages').element(),
      sources().querySelector('summary')!
    ];
    for (let k = 0; k < els.length - 1; k++) before(els[k], els[k + 1]);
    expect(el('fzp-money')!.querySelector('h2')!.textContent).toBe('Public money');
    expect(el('fzp-tiers')!.querySelector('h2')!.textContent).toBe('Who the homes are for');
    before(el('fzp-money-city')!, el('fzp-money-all')!);
  });

  it("every money and tier figure is the scrubbed month's, limits still show", async () => {
    await page.viewport(1024, 768);
    const i = MONEY_LAST - 1;
    await render(SimResults, { props: at(i) });
    await open('Money details');
    await open('Homes by income level');
    const m = moneyAt(money, i);
    expect(el('fzp-money-city')!.textContent).toBe(cityLine(m));
    expect(el('fzp-money-all')!.textContent).toBe(allLine(m, money.publicSpent[i]));
    expect(el('fzp-money-funded')!.textContent).toBe(fundedLine(m));
    expect(el('fzp-money-funded')!.textContent).toBe('Funded homes finished: 2. Added homes: 2.');
    expect(el('fzp-money-lost')).toBeNull();
    const table = el('fzp-money-sources') as HTMLTableElement;
    expect(table.caption!.textContent).toBe(
      `Public money by source, ${formatMonthYear(MONEY_SCORE.months[i])}`
    );
    const heads = [...table.tHead!.rows[0].cells].map((c) => c.textContent!.trim());
    expect(heads).toEqual(['Source', 'Received', 'Spent', 'Lent out']);
    const bond = [...table.tBodies[0].rows].find((r) => r.cells[0].textContent === 'Added bond')!;
    expect(bond.cells[3].textContent!.trim()).toBe(formatDollars(2_000_000));
    const t = tiersAt(tiers, i);
    expect(el('fzp-tiers-affordable')!.textContent).toBe(affordableLine(t));
    const tierRows = [...(el('fzp-tiers-table') as HTMLTableElement).tBodies[0].rows];
    expect(tierRows[0].cells[1].textContent!.trim()).toBe(formatCount(t.rows[0].homes));
    expect(tierRows[4].cells[1].textContent!.trim()).toBe(formatCount(t.unrecorded));
    // Not series: the limit statements show whatever the month.
    expect(el('fzp-money-limits')!.textContent).toContain('Over:');
    expect(el('fzp-money-limits')!.textContent).toContain('Within:');
  });

  it('Loans and guarantees lost column', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, { props: at(MONEY_LAST, { uncapped: new Set(['federal']) }) });
    await open('Money details');
    const table = el('fzp-money-sources') as HTMLTableElement;
    const heads = [...table.tHead!.rows[0].cells].map((c) => c.textContent!.trim());
    expect(heads).toEqual([
      'Source',
      'Received',
      'Spent',
      'Lent out',
      'Repaid',
      'Loans and guarantees lost'
    ]);
    const row = (label: string) =>
      [...table.tBodies[0].rows].find((r) => r.cells[0].textContent === label)!;
    // lostCredit, not lost: the City grant lost at the last month is in Spent, not here.
    expect(row('Added bond').cells[5].textContent!.trim()).toBe(formatDollars(250_000));
    expect(row('General fund').cells[5].textContent!.trim()).toBe('$0');
    expect(row('Federal tax credits').cells[1].textContent!.trim()).toBe('no limit');
    expect(el('fzp-money-lost')!.textContent).toContain(
      `counted as lost (assumption): ${formatDollars(500_000)}. They are in Spent.`
    );
    expect(el('fzp-money-owed')!.textContent).toContain('(not adjusted for inflation)');
  });

  it('"no limit" follows the uncapped prop (Pool.uncapped), not the pool kind', async () => {
    await page.viewport(1024, 768);
    const view = await render(SimResults, { props: at(MONEY_LAST) });
    await open('Money details');
    const received = (label: string) => {
      const table = el('fzp-money-sources') as HTMLTableElement;
      const r = [...table.tBodies[0].rows].find((x) => x.cells[0].textContent === label)!;
      return r.cells[1].textContent!.trim();
    };
    // Without the set, the federal pool shows its received amount like any other.
    expect(received('Federal tax credits')).toBe('$0');
    expect(document.body.textContent).not.toContain('no limit');
    await view.rerender(at(MONEY_LAST, { uncapped: new Set(['state']) }));
    expect(received('State housing programmes')).toBe('no limit');
    expect(received('Federal tax credits')).toBe('$0');
  });

  it('the two F13 sentences under Homes by income level', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, { props: at(MONEY_LAST) });
    await open('Homes by income level');
    const text = el('fzp-tiers')!.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain(
      "A fully funded affordable project's homes are counted in the income levels of the programmes that pay it, in proportion to what each pays."
    );
    expect(text).toContain(
      'Homes in real projects whose records give no income level are counted here and never guessed into a level. Private projects of 10 homes or more count their on-site affordable homes at the legal rate, assuming they build them on site (tier 2).'
    );
    const label = el('fzp-tiers-label')!;
    const funded = el('fzp-tiers-funded')!;
    const unrecorded = el('fzp-tiers-unrecorded')!;
    before(label, funded);
    before(funded, unrecorded);
    before(unrecorded, el('fzp-tiers-sources')!);
  });

  it('the lost-grants line reads the resolved lossOnExit', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, {
      props: at(MONEY_LAST, { terms: resolveTerms(undefined, { lossOnExit: 0.5 }) })
    });
    await open('Money details');
    expect(el('fzp-money-lost')!.textContent).toContain('50% counted as lost');
    expect(el('fzp-money-lost')!.textContent).toContain('custom, not sourced');
  });

  it('TIER_SOURCES, the dataset baseline provenance and MONEY_SOURCES rendered', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, { props: at(MONEY_LAST) });
    const tierBox = el('fzp-tiers-sources')!;
    for (const pv of TIER_SOURCES) expect(tierBox.textContent).toContain(pv.label);
    const base = MONEY_SCORE.baseline;
    expect(el('fzp-tiers-baseline')!.textContent).toContain(tierBaselineLabel(base.since));
    expect(tierBox.textContent).toContain(
      `${base.provenance.label} (tier ${base.provenance.tier})`
    );
    const links = [...tierBox.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toContain(base.provenance.sources[0].url);
    // Beside the TIER_SOURCES list: after its last entry, in the same box.
    const list = tierBox.querySelector('ul')!;
    before(list, el('fzp-tiers-baseline')!);
    const moneyBox = el('fzp-money-sources-list')!;
    for (const pv of MONEY_SOURCES) expect(moneyBox.textContent).toContain(pv.label);
  });

  it('tier label from tierBaselineLabel', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, { props: at(MONEY_LAST) });
    const label = tierBaselineLabel(MONEY_SCORE.baseline.since);
    expect(label).toBe('completed since 30 June 2022 (net)');
    expect(el('fzp-tiers-label')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(
      `The Homes column counts homes ${label}, plus those this run completes.`
    );
  });

  it('disclosures closed by default', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, { props: at(MONEY_LAST) });
    for (const name of ['Money details', 'Homes by income level']) {
      const b = page.getByRole('button', { name }).element();
      expect(b.getAttribute('aria-expanded')).toBe('false');
      const panel = document.getElementById(b.getAttribute('aria-controls')!)!;
      expect(panel.hidden).toBe(true);
      await open(name);
      expect(b.getAttribute('aria-expanded')).toBe('true');
      expect(panel.hidden).toBe(false);
    }
  });

  it('captions and th scope=col', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, { props: at(MONEY_LAST) });
    const tierTable = el('fzp-tiers-table') as HTMLTableElement;
    expect(tierTable.caption!.textContent).toBe(
      `Homes by income level against the 2023–2031 targets, ${formatMonthYear(MONEY_SCORE.months[MONEY_LAST])}`
    );
    for (const table of [el('fzp-money-sources'), tierTable] as HTMLTableElement[]) {
      expect(table.caption).not.toBeNull();
      for (const th of table.tHead!.querySelectorAll('th')) {
        expect(th.getAttribute('scope')).toBe('col');
      }
    }
    const rows = [...tierTable.tBodies[0].rows].map((r) => r.cells[0].textContent!.trim());
    expect(rows).toEqual([
      'Very low',
      'Low',
      'Moderate',
      'Above moderate',
      'Affordable, income level not recorded'
    ]);
    const last = tierTable.tBodies[0].rows[4];
    expect(last.cells[2].textContent!.trim()).toBe('—');
    expect(last.cells[2].getAttribute('aria-label')).toBe('none');
    expect(tierTable.className).toContain('table-fixed');
  });

  it('pending sets aria-busy on both', async () => {
    await page.viewport(1024, 768);
    const screen = await render(SimResults, { props: at(MONEY_LAST) });
    expect(el('fzp-money')!.getAttribute('aria-busy')).toBeNull();
    expect(el('fzp-tiers')!.getAttribute('aria-busy')).toBeNull();
    await screen.rerender(at(MONEY_LAST, { pending: true }));
    await expect.element(page.getByTestId('fzp-money')).toHaveAttribute('aria-busy', 'true');
    await expect.element(page.getByTestId('fzp-tiers')).toHaveAttribute('aria-busy', 'true');
  });

  it('stale keeps values under the stale line', async () => {
    await page.viewport(1024, 768);
    await render(SimResults, { props: at(MONEY_LAST, { stale: true }) });
    const line = page.getByTestId('fzp-score-stale').element();
    before(line, el('fzp-money-city')!);
    expect(el('fzp-money-city')!.textContent).toBe(cityLine(moneyAt(money, MONEY_LAST)));
    expect(el('fzp-money')!.getAttribute('aria-busy')).toBeNull();
    expect(el('fzp-tiers')).not.toBeNull();
  });

  it('no blocks without money and tiers', async () => {
    await page.viewport(1024, 768);
    const bare = { ...TIMELINE_SCORE };
    delete bare.tiers;
    const screen = await render(SimResults, { props: props({ score: bare }) });
    expect(el('fzp-money')).toBeNull();
    expect(el('fzp-tiers')).toBeNull();
    await screen.rerender(props({ score: TIMELINE_SCORE }));
    await expect.element(page.getByTestId('fzp-tiers')).toBeInTheDocument();
    expect(el('fzp-money')).toBeNull();
  });

  it('no limits heading when limits is empty', async () => {
    await page.viewport(1024, 768);
    const score = { ...MONEY_SCORE, money: { ...money, limits: [] } };
    await render(SimResults, {
      props: props({ score, day: dayOf(MONEY_LAST), highWater: dayOf(MONEY_LAST) })
    });
    await open('Money details');
    expect(el('fzp-money-limits')).toBeNull();
    expect(document.body.textContent).not.toContain('Limits on the City borrowing');
  });

  it('market paragraph ends with MARKET_FUNDING_SENTENCE under private, Release 1 text under all', async () => {
    await page.viewport(1024, 768);
    const cal = fixtureCalibration();
    const priv = marketText(cal)!;
    expect(priv.endsWith(` ${MARKET_FUNDING_SENTENCE}`)).toBe(true);
    const screen = await render(SimResults, { props: props({ market: priv }) });
    openSources();
    expect(el('fzp-market')!.textContent!.trim()).toBe(priv);
    const all = structuredClone(cal);
    delete all.baselineFunding;
    const r1 = marketText(all)!;
    expect(r1).toBe(marketSentence(all, 'all'));
    await screen.rerender(props({ market: r1 }));
    await expect.element(page.getByTestId('fzp-market')).toHaveTextContent(r1);
    expect(el('fzp-market')!.textContent).not.toContain(MARKET_FUNDING_SENTENCE);
  });
});
