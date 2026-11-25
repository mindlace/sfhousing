/// <reference types="@vitest/browser-playwright" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { cdp, page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import {
  FIX_ASOF,
  FIX_HORIZON,
  TIMELINE_SCORE,
  TIMELINE_SCORE_R0
} from '$lib/fzp/fixtures/timeline-score';
import { scoreCopy } from '$lib/sim-page/policy';
import { LENS_NAME, TWIN_NOTE } from './copy';
import { ABOUT_ID, WORKED_OUT } from '$lib/about/copy';
import { DEFAULT_LEVERS } from '$lib/sim/levers/types';
import type { LeverCapacity } from '$lib/sim/levers/resolve';
import SimDetails from './SimDetails.svelte';
import { BUTTON } from '$lib/shell/ui';
import SimDetailsHost from './test/SimDetailsHost.svelte';
import type { ChartLens } from './chart-lens';
import { headlineAt as headAt } from './results';
import { yearRows } from './details';
import { formatPercent } from '$lib/scoreboard';
import { builtTowardGoalText, scoreAt } from '$lib/fzp/score-view';
import { dayFromUtc, monthIndex } from '$lib/fzp/time';
import { MONEY_LAST, MONEY_SCORE } from '$lib/fzp/fixtures/money';
import { formatDollars, formatMonthYear } from '$lib/fzp/format';
import {
  affordableLine,
  allLine,
  cityLine,
  fundedLine,
  moneyAt,
  tiersAt,
  plainSources
} from '$lib/fzp/money-view';
import { formatCount } from '$lib/scoreboard/format';
import { resolveTerms } from '$lib/sim/finance';
import {
  MONEY_SOURCES,
  TIER_SOURCES,
  tierBaselineLabel,
  type Money
} from '$lib/sim/scenario/finance-score';
import { LEGACY_UNCAPPED_DOLLARS } from '$lib/timelapse/model';
import type { ResolvedTerms } from '$lib/timelapse/types';
import { EMPTY_LOG, logCompiled, logFilled, viewOfLog } from '$lib/timeline/chunk-log';
import {
  headlineAt,
  headlineText,
  playheadAt,
  resultsAt,
  scoreOfView
} from '$lib/timeline/results';
import { calendarMonths, chunk, statics } from '$lib/timeline/test/fixtures';
import { tierTargetsOf } from '$lib/sim/scenario/score';
import type { TimelineView } from '$lib/sim/world/score/types';
import type { TimelineScore } from '$lib/sim/scenario/types';
import { TODAY, defaultGoal, goalStep, readGoal, type Goal } from '$lib/goal/goal';
import { indexOfDay } from '$lib/timeline/playhead';

/** A goal whose deadline (Jan 2031) falls inside the fixture's window. */
const TEST_GOAL: Goal = { ...defaultGoal(FIX_ASOF), deadline: dayFromUtc(2031, 1, 31) };

/** The old forecast note Details no longer shows. */
const FORECAST_NOTE = 'A forecast if nothing changes.';

/** Index 53 of the fixture: 2031-03-15. */
const DAY = dayFromUtc(2031, 3, 15);

type Overrides = Partial<{
  score: typeof TIMELINE_SCORE | null;
  day: number;
  filledEnd: number;
  reached: number;
  copy: ReturnType<typeof scoreCopy>;
  capacity: LeverCapacity | null;
  stale: boolean;
  pending: boolean;
  terms: ResolvedTerms;
  inForce: boolean;
  lens: ChartLens;
  onactivity: () => void;
  bar: number | null;
}>;

const props = (over: Overrides = {}) => {
  const p = {
    score: TIMELINE_SCORE as typeof TIMELINE_SCORE | null,
    day: DAY,
    asOf: FIX_ASOF,
    horizon: FIX_HORIZON,
    filledEnd: FIX_HORIZON,
    reached: FIX_HORIZON,
    ...over
  };
  const sc = p.score;
  const at = sc ? scoreAt(sc, monthIndex(p.day, sc.months[0], sc.months.length)) : null;
  const months = sc?.months ?? [];
  // The day, the horizon and the reveal are the page's: Details takes the playhead and the
  // month reached.
  const { day, horizon, filledEnd, reached, ...rest } = p;
  void horizon;
  void filledEnd;
  return {
    ...rest,
    goal: TEST_GOAL,
    at,
    view: sc ? viewOfScore(sc) : null,
    playhead: playheadAt(months, p.asOf, day),
    reachedMonth: months.length > 0 && reached > p.asOf ? indexOfDay(months, reached) : TODAY
  };
};

/** The stepped view a fixture score stands for (on the page the score is built from it). */
function viewOfScore(sc: TimelineScore): TimelineView {
  return {
    months: sc.months,
    lastIndex: sc.months.length - 1,
    filledThrough: sc.shown.length - 1,
    rows: sc.shown,
    planEffect: sc.planEffect,
    targets: sc.targets,
    tierTargets: null,
    money: null,
    tiers: null,
    cars: null,
    baseline: sc.baseline,
    phasing: sc.phasing,
    references: sc.references,
    compare: 'plan'
  };
}

async function scheme(value: 'light' | 'dark') {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value }]
  });
}

type DetailsProps = ReturnType<typeof props>;

/**
 * Renders Details with the pointer at rest: the pointer stays where the last test left it, so it
 * first rests on the heading and no explanation is open (as the deleted ScoreChart spec did).
 */
async function renderAtRest(p: DetailsProps) {
  const screen = await render(SimDetails, { props: p });
  await userEvent.hover(page.getByRole('heading', { name: 'Details', exact: true }));
  await expect.element(page.getByRole('tooltip')).not.toBeInTheDocument();
  return screen;
}

afterEach(async () => {
  vi.useRealTimers();
  await scheme('light');
});

/** Details' last line: the link into About's assumptions. */
const workedOut = () => page.getByTestId('details-about');

describe('intro and loading', () => {
  it('has no badge and no forecast note', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(props());
    expect(document.querySelector('[data-testid="fzp-badge"]')).toBeNull();
    expect(document.body.textContent).not.toContain(FORECAST_NOTE);
  });

  it('before the first timeline: only the intro and a loading line', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(props({ score: null }));
    await expect.element(page.getByText('Loading the simulation…').first()).toBeVisible();
    expect(document.querySelector('[data-testid="fzp-built"]')).toBeNull();
    expect(document.querySelector('svg[role="img"]')).toBeNull();
    expect(document.querySelector('[role="meter"]')).toBeNull();
  });
});

describe('layout', () => {
  it('has a Details heading', async () => {
    await page.viewport(1024, 768);
    const first = await renderAtRest(props());
    const h = page.getByRole('heading', { level: 2, name: 'Details', exact: true });
    await expect.element(h).toBeVisible();
    expect(document.querySelector('h2')).toBe(h.element());
    await first.unmount();
    // While loading too.
    await renderAtRest(props({ score: null }));
    await expect.element(h).toBeVisible();
  });

  it('the Activity button in the heading row calls onactivity', async () => {
    await page.viewport(1024, 768);
    const onactivity = vi.fn();
    const first = await renderAtRest(props({ onactivity }));
    const h = page.getByRole('heading', { level: 2, name: 'Details', exact: true }).element();
    const button = page.getByRole('button', { name: 'Activity', exact: true });
    // In the heading's row, after it.
    expect(h.parentElement!.contains(button.element())).toBe(true);
    const r = button.element().getBoundingClientRect();
    expect(r.height).toBeGreaterThanOrEqual(24);
    // The shared button look, not a copy of it.
    expect(button.element().className).toBe(BUTTON);
    await button.click();
    expect(onactivity).toHaveBeenCalledOnce();
    await first.unmount();
    // Without onactivity (no page to show Activity) there is no button.
    await renderAtRest(props());
    expect(page.getByRole('button', { name: 'Activity', exact: true }).elements()).toHaveLength(0);
  });

  it('orders the switch, the goal rows, what the policy added, the sources of homes, stopped, the table, then the About link', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(props());
    const before = (a: Element, b: Element) =>
      expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const els = [
      page.getByRole('heading', { name: 'Details', exact: true }).element(),
      page.getByRole('group', { name: 'Chart' }).element(),
      page.getByTestId('fzp-built').element(),
      page.getByRole('meter').first().element(),
      page.getByText('What current law added').element(),
      page.getByTestId('tl-sources-of-homes').element(),
      page.getByText(/^Proposed homes in projects that stopped/).element(),
      page.getByTestId('tl-year-table').element(),
      workedOut().element()
    ];
    for (let k = 0; k < els.length - 1; k++) before(els[k], els[k + 1]);
  });

  it('Details ends with "How this is worked out" to /about#about-assumptions, at least 24 px tall', async () => {
    await page.viewport(1024, 768);
    const first = await renderAtRest(props());
    const link = page.getByRole('link', { name: WORKED_OUT, exact: true });
    expect(link.element()).toBe(workedOut().element());
    expect(link.element().getAttribute('href')).toBe(`/about#${ABOUT_ID.assumptions}`);
    // The last thing in Details: everything after it in the document is its own content.
    const all = [...document.body.querySelectorAll('*')];
    const after = all.slice(all.indexOf(link.element()) + 1);
    expect(after.every((el) => link.element().contains(el))).toBe(true);
    // A standalone target: 24 px, the same on every pointer.
    const r = link.element().getBoundingClientRect();
    expect(r.height).toBeGreaterThanOrEqual(24);
    expect(r.width).toBeGreaterThanOrEqual(24);
    expect(link.element().classList.contains('min-h-6')).toBe(true);
    expect(link.element().className).not.toMatch(/pointer-coarse:/);
    await first.unmount();
    // While loading too.
    await renderAtRest(props({ score: null }));
    await expect.element(workedOut()).toBeVisible();
  });

  it('Details has no Sources disclosure, dataset line or market paragraph', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(props());
    document.querySelectorAll('details').forEach((d) => (d.open = true));
    expect(document.querySelector('[data-testid="fzp-sources"]')).toBeNull();
    expect(document.querySelector('[data-testid="fzp-market"]')).toBeNull();
    expect(page.getByText('Sources', { exact: true }).elements()).toEqual([]);
    expect(page.getByRole('button', { name: 'Where these numbers come from' }).elements()).toEqual(
      []
    );
    expect(page.getByRole('link', { name: 'Data sources' }).elements()).toEqual([]);
    expect(document.body.textContent).not.toMatch(/fixture-0|Data .* · built/);
    expect(document.body.textContent).not.toContain("today's market");
    expect(document.body.textContent).not.toContain('Multi-phase projects');
  });

  it('has no headline: no fzp-net, no "homes added since", no "built by today"', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(props());
    expect(document.querySelector('[data-testid="fzp-net"]')).toBeNull();
    expect(document.body.textContent).not.toContain('homes added since');
    expect(document.body.textContent).not.toContain('built by today');
  });

  it('says once, with the targets, that the homes built since Jun 2022 count toward the goal', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(props());
    const text = builtTowardGoalText(TIMELINE_SCORE.baseline);
    await expect.element(page.getByTestId('fzp-built')).toHaveTextContent(text);
    expect(document.querySelectorAll('[data-testid="fzp-built"]')).toHaveLength(1);
    expect(document.body.textContent!.split(text)).toHaveLength(2);
    const built = page.getByTestId('fzp-built').element();
    expect(built.parentElement!.contains(page.getByRole('meter').first().element())).toBe(true);
  });
});

describe('pipeline', () => {
  it('shows where the simulated homes come from', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(props());
    expect(monthIndex(DAY, TIMELINE_SCORE.months[0], TIMELINE_SCORE.months.length)).toBe(53);
    const row = (label: string) =>
      page.getByTestId('tl-sources-of-homes').getByText(label, { exact: true }).element()
        .parentElement!.textContent!;
    expect(row("From today's pipeline")).toContain('3,180');
    expect(row('New projects')).toContain('2,120');
  });
});

describe('cars (Review Focus 5)', () => {
  /** The fixture's view with cars: 1,000 households, 1,200 cars today, 10 fewer each month. */
  function withCars(p: DetailsProps): DetailsProps {
    const v = p.view!;
    const n = v.rows.length;
    const c = Array.from({ length: n }, (_, i) => 1200 - 10 * i);
    return {
      ...p,
      view: {
        ...v,
        cars: {
          households: c.map(() => 1000),
          cars: c,
          carless: c.map(() => 300),
          perHousehold: c.map((x) => x / 1000),
          spacesPerHome: c.map(() => null),
          zones: c.map(() => new Float32Array([1, Number.NaN]))
        }
      }
    };
  }
  const carsRows = () => page.getByTestId('tl-cars').elements();

  it('one Cars row after the homes rows: today, the playhead, the change per household', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(withCars(props()));
    expect(carsRows()).toHaveLength(1);
    const row = carsRows()[0];
    // Month 53: 1,200 - 530 cars over 1,000 households.
    expect(row.textContent).toContain('Cars');
    expect(row.textContent).toContain('1,200 → 670');
    expect(row.textContent).toContain('−0.53 per household');
    expect(row.textContent).not.toContain('NaN');
    const homes = page.getByTestId('tl-sources-of-homes').element();
    expect(homes.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('no Cars row without car data', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(props());
    expect(carsRows()).toEqual([]);
    expect(page.getByText('Cars', { exact: true }).elements()).toEqual([]);
  });
});

describe('what the plan added', () => {
  it('shows the plan-effect rows and the twin paragraph', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(props());
    await expect.element(page.getByText('What current law added')).toBeVisible();
    const row = (label: string) =>
      page.getByText(label, { exact: true }).element().parentElement!.textContent!;
    expect(row('Homes completed because of current law')).toContain('1,290');
    expect(row('Homes approved because of current law')).toContain('2,185');
    expect(document.body.textContent).not.toContain('run twice');
    await expect.element(page.getByText(TWIN_NOTE)).not.toBeInTheDocument();
    await page.getByRole('button', { name: 'What current law added' }).click();
    await expect.element(page.getByText(TWIN_NOTE)).toBeVisible();
    expect(
      page
        .getByText('What current law added')
        .element()
        .closest('section')!
        .getAttribute('aria-busy')
    ).toBeNull();
  });

  it('plan effect not yet computed: calculating rows, busy sub-section', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(props({ score: TIMELINE_SCORE_R0 }));
    const row = (label: string) =>
      page.getByText(label, { exact: true }).element().parentElement!.textContent!;
    expect(row('Homes completed because of current law')).toContain('calculating…');
    expect(row('Homes approved because of current law')).toContain('calculating…');
    const section = page.getByText('What current law added').element().closest('section')!;
    expect(section.getAttribute('aria-busy')).toBe('true');
  });

  it('shows a negative effect as a minus count', async () => {
    await page.viewport(1024, 768);
    const p = props();
    await renderAtRest({ ...p, at: { ...p.at!, planCompleted: -569 } });
    await expect.element(page.getByText(formatCount(-569), { exact: true })).toBeVisible();
  });

  it('shows no This city, no range and no scope caption', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(props());
    await expect.element(page.getByTestId('fzp-city')).not.toBeInTheDocument();
    await expect.element(page.getByText(/8 in 10/)).not.toBeInTheDocument();
    await expect.element(page.getByTestId('fzp-scope')).not.toBeInTheDocument();
  });
});

describe('the bar', () => {
  it('shows "To beat" after the last goal row, and nothing without a bar', async () => {
    await page.viewport(1024, 768);
    const first = await renderAtRest({ ...props(), bar: dayFromUtc(2057, 6, 1) });
    const line = page.getByTestId('tl-to-beat');
    await expect.element(line).toHaveTextContent('To beat: Jun 2057');
    const rows = page.getByRole('meter').elements();
    const last = rows[rows.length - 1];
    expect(
      last.compareDocumentPosition(line.element()) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    await first.unmount();
    await renderAtRest({ ...props(), bar: null });
    expect(document.querySelector('[data-testid=tl-to-beat]')).toBeNull();
  });
});

describe('the forecast note', () => {
  it('is not in Details, with or without a policy in force', async () => {
    await page.viewport(1024, 768);
    const r = await renderAtRest(props({ copy: scoreCopy(null) }));
    await expect.element(page.getByText(FORECAST_NOTE)).not.toBeInTheDocument();
    await r.rerender({ copy: scoreCopy({ ...DEFAULT_LEVERS, compare: 'fzp' }) });
    await expect.element(page.getByText(FORECAST_NOTE)).not.toBeInTheDocument();
  });
});

describe('score copy (/sim)', () => {
  it('names your policy and current law for a customised policy', async () => {
    await page.viewport(1024, 768);
    const copy = scoreCopy({ ...DEFAULT_LEVERS, compare: 'fzp' });
    await renderAtRest(props({ copy }));
    await expect.element(page.getByText('What your policy added')).toBeVisible();
    await expect.element(page.getByText('What current law added')).not.toBeInTheDocument();
    await expect.element(page.getByText(FORECAST_NOTE)).not.toBeInTheDocument();
    const row = (label: string) =>
      page.getByText(label, { exact: true }).element().parentElement!.textContent!;
    expect(row('Homes completed because of your policy')).toContain('1,290');
    expect(row('Homes approved because of your policy')).toContain('2,185');
    await page.getByRole('button', { name: 'What your policy added' }).click();
    await expect.element(page.getByText(TWIN_NOTE)).toBeVisible();
  });

  it('names the comparison in the added section', async () => {
    await page.viewport(1024, 768);
    const screen = await renderAtRest(props({ copy: scoreCopy(null) }));
    const first = () => page.getByText('What current law added').element().closest('section')!;
    expect(first().querySelector('p')!.textContent!.trim()).toBe(
      'Current law added 1,290 homes vs the old zoning'
    );
    await screen.rerender(props({ copy: scoreCopy({ ...DEFAULT_LEVERS, compare: 'fzp' }) }));
    const mine = page.getByText('What your policy added').element().closest('section')!;
    expect(mine.querySelector('p')!.textContent!.trim()).toBe(
      'Your policy added 1,290 homes vs current law'
    );
    await screen.rerender(props({ score: TIMELINE_SCORE_R0, copy: scoreCopy(null) }));
    expect(first().getAttribute('aria-busy')).toBe('true');
    expect(first().querySelector('p')!.textContent!.trim()).toBe(
      'Current law vs the old zoning: calculating…'
    );
  });

  it('says current law for the no-policy copy', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(props({ copy: scoreCopy(null) }));
    await expect.element(page.getByText('What current law added')).toBeVisible();
  });

  it('no Details text says FZP or the plan, with and without a policy', async () => {
    await page.viewport(1024, 768);
    const screen = await renderAtRest(props({ copy: scoreCopy(null) }));
    for (const copy of [scoreCopy(null), scoreCopy({ ...DEFAULT_LEVERS, compare: 'fzp' })]) {
      await screen.rerender(props({ copy }));
      expect(document.body.textContent).not.toMatch(/\bFZP\b/);
      expect(document.body.textContent).not.toMatch(/\bthe plan\b/);
    }
  });

  it('the default levers get the current-law copy', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(props({ copy: scoreCopy(DEFAULT_LEVERS) }));
    await expect.element(page.getByText('What current law added')).toBeVisible();
  });
});

describe('protections cost (/sim)', () => {
  const PROT = /lots protected:/;

  it('names the protected lots and the zoned capacity they cost', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(
      props({
        capacity: { plan: 900, withoutProtections: 1000, protectedLots: 12 }
      })
    );
    const line = page.getByText(PROT);
    await expect
      .element(line)
      .toHaveTextContent('12 lots protected: 100 fewer homes of zoned capacity');
    // Not live-announced: no live region on or around the line.
    expect(line.element().closest('[aria-live], [role="status"], [role="alert"]')).toBeNull();
  });

  it('formats large numbers with formatCount', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(
      props({
        capacity: { plan: 0, withoutProtections: 12345, protectedLots: 1200 }
      })
    );
    await expect
      .element(page.getByText(PROT))
      .toHaveTextContent('1,200 lots protected: 12,345 fewer homes of zoned capacity');
  });

  it('reads in the singular for one lot and one home', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(
      props({
        capacity: { plan: 900, withoutProtections: 901, protectedLots: 1 }
      })
    );
    await expect
      .element(page.getByText(/lot protected:/))
      .toHaveTextContent('1 lot protected: 1 fewer home of zoned capacity');
  });

  it('shows no line with no protected lots or no capacity', async () => {
    await page.viewport(1024, 768);
    const r = await renderAtRest(
      props({
        capacity: { plan: 900, withoutProtections: 900, protectedLots: 0 }
      })
    );
    await expect.element(page.getByTestId('fzp-built')).toBeVisible();
    expect(document.body.textContent).not.toMatch(PROT);
    await r.rerender({ capacity: null });
    expect(document.body.textContent).not.toMatch(PROT);
  });
});

describe('targets and progress', () => {
  /** The deadline preview lines, in row order. */
  const previews = () =>
    [...document.querySelectorAll('[data-testid^="goal-row-"] p')]
      .map((p) => p.textContent!.trim())
      .filter((t) => t.startsWith('At the deadline'));

  it('renders Goal then Goal + 15%, each with its deadline preview', async () => {
    await page.viewport(1024, 768);
    const p = props({ day: dayFromUtc(2030, 6, 1) });
    await renderAtRest(p);
    const meters = page.getByRole('meter').elements();
    expect(meters.map((m) => m.getAttribute('aria-label'))).toEqual(['Goal', 'Goal + 15%']);
    expect(previews()).toEqual(['At the deadline: 20%', 'At the deadline: 18%']);
  });

  it('the deadline line waits until the furthest date reaches the deadline', async () => {
    await page.viewport(1024, 768);
    const before = await renderAtRest(
      props({ day: dayFromUtc(2030, 6, 1), reached: dayFromUtc(2030, 12, 31) })
    );
    expect(document.body.textContent).not.toContain('At the deadline');
    await before.unmount();

    const p = props({ day: dayFromUtc(2030, 6, 1), reached: dayFromUtc(2031, 1, 1) });
    await renderAtRest(p);
    const view = p.view!;
    const deadline = goalStep(TEST_GOAL, view)!.deadlineIndex;
    const value = TEST_GOAL.measure.valueAt(view, deadline);
    expect(previews()).toEqual([
      `At the deadline: ${formatPercent(value / 82_069)}`,
      `At the deadline: ${formatPercent(value / 94_379)}`
    ]);
  });

  it('draws no chart of its own and no in-progress rows', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(props());
    expect(document.querySelector('svg[role="img"]')).toBeNull();
    expect(document.querySelector('[data-testid="fzp-chart"]')).toBeNull();
    expect(document.querySelector('[data-testid="fzp-stages"]')).toBeNull();
    expect(document.body.textContent).not.toContain('still in progress');
    expect(document.body.textContent).not.toContain('Toward the goal');
    await expect
      .element(page.getByText('Proposed homes in projects that stopped since October 2026: 265'))
      .toBeInTheDocument();
  });
});

describe('map key', () => {
  // The key moved onto the map (MapKeyControl, SimKey): its legend cases are in
  // src/lib/timeline/SimKey.svelte.spec.ts and src/lib/map/key/MapKeyControl.svelte.spec.ts.
  it('Details holds no map key', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(props());
    expect(document.querySelector('.sfh-fzp-legend')).toBeNull();
    expect(document.querySelector('[data-legend]')).toBeNull();
    expect(page.getByText('Map key').elements()).toEqual([]);
    expect(page.getByText(/Bar length|solid floors|in Planning review/).elements()).toEqual([]);
    const tokenCss = [...document.head.querySelectorAll('style')].filter((st) =>
      st.textContent?.includes('.sfh-fzp-legend')
    );
    expect(tokenCss).toEqual([]);
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
    await renderAtRest(props());
    expectTarget(
      document.querySelector('[data-testid="tl-year-table"] > summary')!,
      'Show as table summary'
    );
    expectTarget(workedOut().element(), WORKED_OUT);
  });

  it('summaries and the About link carry the 24 px minimum, the same on every pointer', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(props());
    for (const el of [
      document.querySelector('[data-testid="tl-year-table"] > summary')!,
      workedOut().element()
    ]) {
      expect(el.classList.contains('min-h-6'), el.outerHTML).toBe(true);
      expect(el.className, el.outerHTML).not.toMatch(/pointer-coarse:/);
      expect(el.getBoundingClientRect().height, el.outerHTML).toBeGreaterThanOrEqual(24);
    }
  });
});

describe('public money and income tiers (funding-ui 4.11)', () => {
  const money = MONEY_SCORE.money as Money;
  const tiers = MONEY_SCORE.tiers!;
  /** The 15th of month `i` of the fixture. */
  const dayOf = (i: number) => MONEY_SCORE.months[i] + 14;
  const at = (i: number, over: Overrides = {}) =>
    props({ score: MONEY_SCORE, day: dayOf(i), filledEnd: dayOf(i), ...over });
  const el = (id: string) => document.querySelector(`[data-testid="${id}"]`);
  const open = async (name: string) => {
    await page.getByRole('button', { name }).click();
  };
  const before = (a: Element, b: Element) =>
    expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  it('two blocks in the order of 4.11', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(at(MONEY_LAST));
    const els = [
      page.getByTestId('fzp-built').element(),
      page.getByRole('meter').first().element(),
      page.getByText('What current law added').element(),
      page.getByTestId('tl-sources-of-homes').element(),
      el('fzp-money')!,
      el('fzp-tiers')!,
      page.getByTestId('tl-year-table').element(),
      workedOut().element()
    ];
    for (let k = 0; k < els.length - 1; k++) before(els[k], els[k + 1]);
    expect(el('fzp-money')!.querySelector('h3')!.textContent).toMatch(/Public money$/);
    expect(el('fzp-tiers')!.querySelector('h3')!.textContent).toMatch(/Who the homes are for$/);
    before(el('fzp-money-city')!, el('fzp-money-all')!);
  });

  it("every money and tier figure is the scrubbed month's, limits still show", async () => {
    await page.viewport(1024, 768);
    const i = MONEY_LAST - 1;
    await renderAtRest(at(i));
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
    await renderAtRest(at(MONEY_LAST));
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
    expect(el('fzp-money-lost')!.textContent).toContain(
      `counted as lost (assumption): ${formatDollars(500_000)}. They are in Spent.`
    );
    expect(el('fzp-money-owed')!.textContent).toContain('(not adjusted for inflation)');
  });

  /** The Received cell of the row labelled `label` in "By source". */
  const received = (label: string) => {
    const table = el('fzp-money-sources') as HTMLTableElement;
    const r = [...table.tBodies[0].rows].find((x) => x.cells[0].textContent === label)!;
    return r.cells[1].textContent!.trim();
  };
  /** MONEY_SCORE with its pools changed by `f`. */
  const withPools = (f: (pools: Money['pools']) => Money['pools']): TimelineScore => ({
    ...MONEY_SCORE,
    money: { ...money, pools: f(money.pools) }
  });

  it("Received shows the federal pool's dollars", async () => {
    await page.viewport(1024, 768);
    await renderAtRest(at(MONEY_LAST));
    await open('Money details');
    const fed = moneyAt(money, MONEY_LAST).pools.find((p) => p.id === 'federal')!;
    expect(fed.received).toBeGreaterThan(0);
    expect(received('Federal tax credits')).toBe(formatDollars(fed.received));
    expect(document.body.textContent).not.toContain('No ceiling');
  });

  it('reads No ceiling under Received for a pool that received ten trillion', async () => {
    await page.viewport(1024, 768);
    const score = withPools((pools) =>
      pools.map((p) =>
        p.id === 'federal' ? { ...p, received: p.received.map(() => LEGACY_UNCAPPED_DOLLARS) } : p
      )
    );
    await renderAtRest(at(MONEY_LAST, { score }));
    await open('Money details');
    expect(received('Federal tax credits')).toBe('No ceiling');
    // Every other cell shows dollars.
    expect(received('State housing programmes')).toBe(
      formatDollars(moneyAt(money, MONEY_LAST).pools.find((p) => p.id === 'state')!.received)
    );
  });

  it('lists a baseline pool with no programme in By source', async () => {
    await page.viewport(1024, 768);
    const zero = money.pools[0].received.map(() => 0);
    const score = withPools((pools) => [
      ...pools,
      {
        id: 'city-housing-stability-fund',
        label: 'Housing Stability Fund',
        kind: 'dedicatedTax',
        received: zero,
        committed: zero,
        out: zero,
        spent: zero,
        repaid: zero,
        lost: zero,
        lostCredit: zero
      }
    ]);
    await renderAtRest(at(MONEY_LAST, { score }));
    await open('Money details');
    expect(received('Housing Stability Fund')).toBe('$0');
    expect(el('fzp-money-all')!.textContent).toBe(
      allLine(moneyAt(money, MONEY_LAST), money.publicSpent[MONEY_LAST])
    );
  });

  it('the two F13 sentences under Homes by income level', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(at(MONEY_LAST));
    await open('Homes by income level');
    const text = el('fzp-tiers')!.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain(
      "A funded affordable project's homes are counted in the income levels of the programmes that pay it, in proportion to what each pays."
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
    await renderAtRest(at(MONEY_LAST, { terms: resolveTerms(undefined, { lossOnExit: 0.5 }) }));
    await open('Money details');
    expect(el('fzp-money-lost')!.textContent).toContain('50% counted as lost');
    expect(el('fzp-money-lost')!.textContent).toContain('custom, not sourced');
  });

  it('TIER_SOURCES, the dataset baseline provenance and MONEY_SOURCES rendered', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(at(MONEY_LAST));
    const tierBox = el('fzp-tiers-sources')!;
    // As shown: no plain label says RHNA (plainSources); the links keep the documents' names.
    for (const pv of plainSources(TIER_SOURCES)) expect(tierBox.textContent).toContain(pv.label);
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
    await renderAtRest(at(MONEY_LAST));
    const label = tierBaselineLabel(MONEY_SCORE.baseline.since);
    expect(label).toBe('completed since 30 June 2022 (net)');
    expect(el('fzp-tiers-label')!.textContent!.replace(/\s+/g, ' ').trim()).toBe(
      `The Homes column counts homes ${label}, plus those this run completes.`
    );
  });

  it('disclosures closed by default', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(at(MONEY_LAST));
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
    await renderAtRest(at(MONEY_LAST));
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
    const screen = await renderAtRest(at(MONEY_LAST));
    expect(el('fzp-money')!.getAttribute('aria-busy')).toBeNull();
    expect(el('fzp-tiers')!.getAttribute('aria-busy')).toBeNull();
    await screen.rerender(at(MONEY_LAST, { pending: true }));
    await expect.element(page.getByTestId('fzp-money')).toHaveAttribute('aria-busy', 'true');
    await expect.element(page.getByTestId('fzp-tiers')).toHaveAttribute('aria-busy', 'true');
  });

  it('stale keeps values under the stale line', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(at(MONEY_LAST, { stale: true }));
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
    const screen = await renderAtRest(props({ score: bare }));
    expect(el('fzp-money')).toBeNull();
    expect(el('fzp-tiers')).toBeNull();
    await screen.rerender(props({ score: TIMELINE_SCORE }));
    await expect.element(page.getByTestId('fzp-tiers')).toBeInTheDocument();
    expect(el('fzp-money')).toBeNull();
  });

  it('no limits heading when limits is empty', async () => {
    await page.viewport(1024, 768);
    const score = { ...MONEY_SCORE, money: { ...money, limits: [] } };
    await renderAtRest(props({ score, day: dayOf(MONEY_LAST), filledEnd: dayOf(MONEY_LAST) }));
    await open('Money details');
    expect(el('fzp-money-limits')).toBeNull();
    expect(document.body.textContent).not.toContain('Limits on the City borrowing');
  });
});

describe('fed from a stepped view (timeline-ui rule 26)', () => {
  const view = (): TimelineView =>
    viewOfLog(
      logFilled(
        logCompiled(EMPTY_LOG, statics({ finance: true })),
        chunk(0, 24, { pools: ['a', 'b'] })
      )
    )!;
  const IDX = 12;
  const feed = (v: TimelineView, over: Overrides = {}) => {
    const score = scoreOfView(v, null);
    const at = resultsAt(v, null, IDX);
    return {
      ...props({ score, filledEnd: v.months[v.filledThrough], ...over }),
      at,
      view: v,
      asOf: v.months[0]
    };
  };

  it('renders every row of rule 26', async () => {
    await page.viewport(1024, 768);
    const v = view();
    await renderAtRest(feed(v));
    const text = document.body.textContent!;
    expect(page.getByTestId('fzp-built').element().textContent).toBe(
      builtTowardGoalText(v.baseline)
    );
    expect(text).not.toContain('still in progress');
    expect(text).toContain("From today's pipeline");
    expect(text).toContain('New projects');
    expect(text).toContain('Proposed homes in projects that stopped');
    expect(text).toContain('What current law added');
    expect(text).toContain('Homes completed because of current law');
    expect(text).not.toContain('still calculating');
    expect(document.querySelector('[data-testid="fzp-chart"]')).toBeNull();
    expect(document.querySelectorAll('[role="meter"]').length).toBeGreaterThan(0);
    expect(document.querySelector('[data-testid="details-about"]')).not.toBeNull();
    expect(
      document.querySelector('[data-testid="tl-year-table"] > summary')!.textContent
    ).toContain('Show as table');
    expect(document.querySelector('[data-testid="fzp-money"]')).not.toBeNull();
  });

  it('reads the per-home figures and the share by month from the view, unlabelled', async () => {
    await page.viewport(1024, 768);
    const v = view();
    const n = v.filledThrough + 1;
    const col = (x: number) => Array.from({ length: n }, (_, k) => (k === IDX ? x : 1));
    const withSentinel: TimelineView = {
      ...v,
      money: {
        ...v.money!,
        perAddedHomeByMonth: { all: col(123456), city: col(654321) },
        displacedShareByMonth: col(0.5)
      }
    };
    await renderAtRest(feed(withSentinel));
    const all = page.getByTestId('fzp-money-all').element().textContent!;
    expect(all).toContain('$123,456 per added home ·');
    expect(page.getByTestId('fzp-money-city').element().textContent).toContain(
      '$654,321 per added home ·'
    );
    const d = page.getByTestId('fzp-money-displaced').element().textContent!;
    expect(d).toContain('(50% of funded homes)');
    expect(`${all}${d}`).not.toMatch(/ by \d{4}/);
  });

  it('renders the tier block when a tier baseline is given', async () => {
    await page.viewport(1024, 768);
    const v = view();
    const baseline = { veryLow: 100, low: 100, moderate: 100, aboveModerate: 700, unrecorded: 0 };
    const tiers = v.rows.map((_, i) => ({
      veryLow: i,
      low: i,
      moderate: i,
      aboveModerate: i,
      unrecorded: 0
    }));
    const withTiers: TimelineView = { ...v, tiers, tierTargets: tierTargetsOf(baseline, tiers) };
    const score = scoreOfView(withTiers, baseline);
    const at = resultsAt(withTiers, baseline, IDX);
    await renderAtRest({ ...feed(withTiers), score, at, view: withTiers });
    const h2s = [
      ...document.querySelectorAll('[data-testid="fzp-money"] h3, [data-testid="fzp-tiers"] h3')
    ];
    expect(h2s.map((h) => h.textContent)).toEqual(['Public money', 'Who the homes are for']);
  });
});

describe("the target rows hold at the goal's deadline, as the header does", () => {
  /** 60 calendar months from Nov 2026: the goal's deadline (Jan 2031) is month 50. */
  const view = (units = 1000, base = 0): TimelineView => {
    const st = statics({ lastIndex: 59 });
    return calendarMonths(
      viewOfLog(
        logFilled(
          logCompiled(EMPTY_LOG, { ...st, baseline: { ...st.baseline, units } }),
          chunk(0, 60, { base })
        )
      )!
    );
  };
  /** At month `i` (today when `atToday`), with every month reached. */
  const feedAt = (v: TimelineView, i: number, atToday = false) => {
    const score = scoreOfView(v, null);
    return {
      ...props({ score, day: v.months[i], filledEnd: v.months[v.lastIndex] }),
      at: resultsAt(v, null, i, score),
      view: v,
      asOf: v.months[0],
      playhead: { index: i, atToday },
      reachedMonth: v.lastIndex
    };
  };
  /** The percentage text of each goal row, in order. */
  const rowPercents = () =>
    [...document.querySelectorAll('[data-testid^="goal-row-"]')].map((row) =>
      row.querySelector('.tabular-nums')!.textContent!.trim()
    );
  /** Each row's percentage at month `i` of `v`: the measure over the goal and over the buffer. */
  const percentsAt = (v: TimelineView, i: number) =>
    [82_069, 94_379].map((a) => formatPercent(TEST_GOAL.measure.valueAt(v, i) / a));
  /** The text lines under each goal row's meter, in order. */
  const rowLines = (id: string) =>
    [...document.querySelectorAll(`[data-testid="goal-row-${id}"] p`)].map((p) =>
      p.textContent!.trim()
    );
  const header = (v: TimelineView, at: { index: number; atToday: boolean }) =>
    headlineText(headlineAt(v, at, { provisional: false, inForce: false }, TEST_GOAL)!, TEST_GOAL)
      .goal!;
  const DEADLINE = 50;

  it('the deadline is month 50 of the view', () => {
    expect(goalStep(TEST_GOAL, view())!.deadlineIndex).toBe(DEADLINE);
  });

  it('before the deadline the rows read the playhead and the deadline line shows', async () => {
    await page.viewport(1024, 768);
    const v = view();
    const i = 30;
    await renderAtRest(feedAt(v, i));
    expect(rowPercents()).toEqual(percentsAt(v, i));
    expect(rowLines('goal')[0]).toMatch(/ to go by Jan 2031$/);
    expect(document.body.textContent).toContain('At the deadline: ');
  });

  it("at today the goal row reads the header's percentage, not month 0's", async () => {
    await page.viewport(1024, 768);
    // 1,000 before today and 501 in month 0: 1.2% of the goal at today, 1.8% at month 0.
    const v = view(1000, 500);
    expect(percentsAt(v, 0)[0]).not.toBe(percentsAt(v, TODAY)[0]);
    await renderAtRest(feedAt(v, 0, true));
    expect(header(v, { index: 0, atToday: true })).toBe(`${percentsAt(v, TODAY)[0]} of the goal`);
    expect(rowPercents()).toEqual(percentsAt(v, TODAY));
    expect(page.getByRole('meter').elements()[0].getAttribute('aria-valuenow')).toBe(
      String(v.baseline.completedNet)
    );
    expect(rowLines('goal')[0]).toMatch(/ to go by Jan 2031$/);
  });

  it('past the deadline the rows hold the deadline month, the goal row as the header says', async () => {
    await page.viewport(1024, 768);
    const v = view();
    const i = 57;
    await renderAtRest(feedAt(v, i));
    const goalPercent = formatPercent(readGoal(TEST_GOAL, v, i)!.fraction);
    expect(header(v, { index: i, atToday: false })).toBe(`${goalPercent} of the goal`);
    expect(rowPercents()[0]).toBe(goalPercent);
    expect(rowPercents()).toEqual(percentsAt(v, DEADLINE));
    expect(document.body.textContent).not.toContain('At the deadline');
    expect(page.getByRole('meter').elements()[0].getAttribute('aria-valuenow')).toBe(
      String(v.baseline.completedNet + v.rows[DEADLINE].completedNet)
    );
  });

  it('past the deadline the rows say Held at Jan 2031 and the buffer row is dated', async () => {
    await page.viewport(1024, 768);
    const v = view();
    await renderAtRest(feedAt(v, 57));
    expect(rowLines('goal')[1]).toBe('Held at Jan 2031');
    expect(rowLines('buffer')[1]).toBe('Held at Jan 2031');
    expect(rowLines('buffer')).toHaveLength(2);
  });

  it('before the deadline the buffer row is dated too', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(feedAt(view(), 30));
    expect(rowLines('buffer')[0]).toMatch(/^[\d,]+ to go by Jan 2031$/);
  });

  it('at the deadline month the deadline line is gone', async () => {
    await page.viewport(1024, 768);
    const v = view();
    await renderAtRest(feedAt(v, DEADLINE));
    expect(rowPercents()).toEqual(percentsAt(v, DEADLINE));
    expect(document.body.textContent).not.toContain('At the deadline');
    expect(rowLines('goal')[1]).toBe('Held at Jan 2031');
  });

  it('names no RHNA and no FZP', async () => {
    await page.viewport(1024, 768);
    const v = view();
    for (const [i, atToday] of [
      [0, true],
      [30, false],
      [57, false]
    ] as const) {
      const screen = await renderAtRest(feedAt(v, i, atToday));
      expect(page.getByRole('meter').elements()).toHaveLength(2);
      document.querySelectorAll('details').forEach((d) => (d.open = true));
      expect(document.body.textContent).not.toMatch(/RHNA/);
      expect(document.body.textContent).not.toMatch(/\bFZP\b/);
      await screen.unmount();
    }
  });

  it('a goal reached before the deadline: the rows still hold the deadline month', async () => {
    await page.viewport(1024, 768);
    // 82,000 before today and 3k + 1 a month: the goal (82,069) is reached in month 23.
    const v = view(82_000);
    const i = 57;
    await renderAtRest(feedAt(v, i));
    expect(
      headlineText(
        headlineAt(
          v,
          { index: i, atToday: false },
          { provisional: false, inForce: false },
          TEST_GOAL
        )!,
        TEST_GOAL
      ).goal
    ).toBe('Goal reached, Oct 2028');
    expect(rowPercents()[0]).toBe(formatPercent(readGoal(TEST_GOAL, v, i)!.fraction));
    expect(rowPercents()).toEqual(percentsAt(v, DEADLINE));
    expect(document.body.textContent).not.toContain('At the deadline');
  });
});

describe('the Chart switch and the year table', () => {
  const radios = () =>
    page
      .getByRole('group', { name: 'Chart' })
      .getByRole('radio')
      .elements()
      .map((r) => (r as HTMLInputElement).labels![0].textContent!.trim());
  const checked = () =>
    (
      page
        .getByRole('group', { name: 'Chart' })
        .element()
        .querySelector(':checked') as HTMLInputElement | null
    )?.value ?? null;

  /** Details in a host that binds its lens, the pointer at rest. */
  async function renderHost(p: DetailsProps & { initialLens?: ChartLens; shown?: boolean }) {
    const screen = await render(SimDetailsHost, { props: p });
    await userEvent.hover(page.getByRole('heading', { name: 'Details', exact: true }));
    await expect.element(page.getByRole('tooltip')).not.toBeInTheDocument();
    return screen;
  }
  const hostLens = () => page.getByTestId('host-lens');

  it('the Chart fieldset: Homes, By source; From your policy only in force; choosing sets lens', async () => {
    await page.viewport(1024, 768);
    const screen = await renderHost(props());
    const group = page.getByRole('group', { name: 'Chart' });
    expect(group.element().tagName).toBe('FIELDSET');
    expect(radios()).toEqual([LENS_NAME.homes, LENS_NAME.source]);
    expect(checked()).toBe('homes');
    await page.getByRole('radio', { name: 'By source' }).click();
    await expect.element(hostLens()).toHaveTextContent('source');
    await screen.rerender({ inForce: true });
    expect(radios()).toEqual([LENS_NAME.homes, LENS_NAME.source, LENS_NAME.effect]);
    await page.getByRole('radio', { name: 'From your policy' }).click();
    await expect.element(hostLens()).toHaveTextContent('effect');
    expect(checked()).toBe('effect');
  });

  it('a choice no longer offered goes back to Homes; a policy added again does not bring it back', async () => {
    await page.viewport(1024, 768);
    const screen = await renderHost({ ...props({ inForce: true }), initialLens: 'effect' });
    expect(checked()).toBe('effect');
    // The policy goes (or the held document has none): the radio goes and Homes is checked.
    await screen.rerender({ inForce: false });
    await expect.element(hostLens()).toHaveTextContent('homes');
    expect(checked()).toBe('homes');
    expect(radios()).not.toContain(LENS_NAME.effect);
    await screen.rerender({ inForce: true });
    expect(radios()).toContain(LENS_NAME.effect);
    await expect.element(hostLens()).toHaveTextContent('homes');
    expect(checked()).toBe('homes');
  });

  it('unmounting sets lens back to homes', async () => {
    await page.viewport(1024, 768);
    const screen = await renderHost({ ...props(), initialLens: 'source' });
    expect(checked()).toBe('source');
    await screen.rerender({ shown: false });
    expect(page.getByRole('group', { name: 'Chart' }).elements()).toHaveLength(0);
    await expect.element(hostLens()).toHaveTextContent('homes');
  });

  it("the table stops at the playhead's month", async () => {
    await page.viewport(1024, 768);
    const p = props({ inForce: true });
    await renderAtRest(p);
    await page.getByText('Show as table').click();
    const table = page.getByRole('table', { name: 'Running total from today, by year' });
    await expect.element(table).toBeVisible();
    const t = table.element() as HTMLTableElement;
    expect([...t.tHead!.rows[0].cells].map((c) => c.textContent!.trim())).toEqual([
      'Year',
      'Homes',
      "From today's pipeline",
      'New projects',
      'From your policy'
    ]);
    const view = p.view!;
    const i = p.playhead.index;
    expect(i).toBe(53);
    const rows = [...t.tBodies[0].rows];
    const want = yearRows(view, i, true);
    expect(rows.map((r) => r.cells[0].textContent!.trim())).toEqual(want.map((r) => r.label));
    // The last row is the playhead's month, as the header reads it; nothing after it.
    const last = rows.at(-1)!;
    expect(last.cells[0].textContent!.trim()).toBe('Mar 2031');
    const head = headAt(view, p.playhead, { provisional: false, inForce: true }, TEST_GOAL)!;
    expect(last.cells[1].textContent!.trim()).toBe(formatCount(head.homes));
    expect(last.cells[4].textContent!.trim()).toBe(`+${formatCount(head.effect!)}`);
    expect(Math.max(...want.map((r) => r.index))).toBe(i);
  });

  it('without a policy the table has no From your policy column; at today there is no table', async () => {
    await page.viewport(1024, 768);
    const first = await renderAtRest(props());
    await page.getByText('Show as table').click();
    const t = page.getByRole('table').element() as HTMLTableElement;
    expect([...t.tHead!.rows[0].cells].map((c) => c.textContent!.trim())).not.toContain(
      'From your policy'
    );
    expect(t.tBodies[0].rows[0].cells).toHaveLength(4);
    await first.unmount();
    await renderAtRest(props({ day: FIX_ASOF }));
    expect(document.querySelector('[data-testid="tl-year-table"]')).toBeNull();
  });

  it('a pointer left resting on an explanation does not keep Show as table from opening', async () => {
    await page.viewport(1024, 768);
    const first = await renderAtRest(props());
    await userEvent.hover(page.getByRole('button', { name: 'What current law added' }));
    await expect.element(page.getByRole('tooltip')).toBeVisible();
    // The pointer stays where the explanation was; the next Details is drawn under it.
    await first.unmount();
    await renderAtRest(props());
    await page.getByText('Show as table').click();
    await expect.element(page.getByRole('columnheader', { name: 'Year' })).toBeVisible();
  });
});

describe('fix round 1', () => {
  it("Details' sections are h3 under the Details h2; the limits heading is h4", async () => {
    await page.viewport(1024, 768);
    await renderAtRest(props({ score: MONEY_SCORE, day: MONEY_SCORE.months[MONEY_LAST] + 14 }));
    const levels = [...document.querySelectorAll('h2, h3, h4')].map(
      (h) => `${h.tagName} ${h.textContent!.trim()}`
    );
    expect(levels).toEqual([
      'H2 Details',
      'H3 What current law added',
      'H3 Public money',
      'H4 Limits on the City borrowing this policy adds (shown, not enforced)',
      'H3 Who the homes are for'
    ]);
  });

  it('at today the money and tier blocks are not shown, as the table is not', async () => {
    await page.viewport(1024, 768);
    const p = props({ score: MONEY_SCORE, day: FIX_ASOF });
    expect(p.playhead.atToday).toBe(true);
    await renderAtRest(p);
    await expect.element(page.getByText('What current law added')).toBeVisible();
    expect(document.querySelector('[data-testid="fzp-money"]')).toBeNull();
    expect(document.querySelector('[data-testid="fzp-tiers"]')).toBeNull();
    expect(document.querySelector('[data-testid="tl-year-table"]')).toBeNull();
  });

  it('no plain label in Homes by income level says RHNA; only citation links may', async () => {
    await page.viewport(1024, 768);
    await renderAtRest(props({ score: MONEY_SCORE, day: MONEY_SCORE.months[MONEY_LAST] + 14 }));
    await page.getByRole('button', { name: 'Homes by income level' }).click();
    const tiers = page.getByTestId('fzp-tiers').element().cloneNode(true) as HTMLElement;
    tiers.querySelectorAll('a').forEach((a) => a.remove());
    expect(tiers.textContent).not.toMatch(/RHNA/);
    expect(tiers.textContent).toContain('since the start of the goal period');
  });
});
