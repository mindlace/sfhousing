/// <reference types="@vitest/browser-playwright" />
import type { ComponentProps } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { chanceTable } from '$lib/timelapse/model';
import type { ProjectCard } from '$lib/sim/protocol';
import { CHANCE_EXPLANATION, SIMULATED_DISCLAIMER, cardStatus } from './card';
import {
  APPROXIMATE,
  EXITED,
  FIX_ASOF,
  NO_QUALITY,
  PHASE_ESTIMATED,
  REAL_ACTUAL,
  SIMULATED,
  SIMULATED_LOCAL,
  TIER0,
  TIER3,
  TIER4_MASSING,
  UNENRICHED,
  WITH_QUALITY
} from './fixtures/cards';
import { fixtureCalibration, tier3Calibration } from './fixtures/calibration';
import { formatChance } from './format';
import ProjectCardPanel from './ProjectCardPanel.svelte';
import { SUMMARY_COPY, type SummaryState } from './summary-request';

const cal = fixtureCalibration();
const chance = chanceTable(cal);

const stageDay = (card: ProjectCard, stage: string) =>
  card.stages.find((s) => s.stage === stage)!.day;

type Props = ComponentProps<typeof ProjectCardPanel>;

const project = (card: ProjectCard): SummaryState => ({ kind: 'project', card });

async function setup(state: SummaryState, over: Partial<Props> = {}) {
  const onclose = vi.fn();
  const onsource = vi.fn();
  const props: Props = {
    state,
    day: FIX_ASOF,
    asOf: FIX_ASOF,
    calibration: cal,
    chance,
    onclose,
    onsource,
    ...over
  };
  const view = await render(ProjectCardPanel, { props });
  return { onclose, onsource, view };
}

const text = (s: string | RegExp) => page.getByText(s);
const panel = () => page.getByRole('region').element() as HTMLElement;

afterEach(() => {
  document.documentElement.style.removeProperty('--map-controls-br-block-size');
});

describe('summary states', () => {
  it.each([
    ['loading', SUMMARY_COPY.loading],
    ['not-loaded', 'Project details are still loading for this area.'],
    ['none', 'No project on this parcel at this date.'],
    ['unavailable', 'Details unavailable']
  ] as const)('%s shows its copy', async (kind, copy) => {
    await page.viewport(1280, 800);
    await setup({ kind });
    await expect.element(text(copy)).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Close' })).toBeVisible();
  });

  it('renders nothing while idle', async () => {
    await setup({ kind: 'idle' });
    expect(document.querySelector('[role="region"]')).toBeNull();
  });

  it('says no project when the day is before the first stage', async () => {
    await setup(project(REAL_ACTUAL), { day: stageDay(REAL_ACTUAL, 'filed') - 400 });
    await expect.element(text('No project on this parcel at this date.')).toBeVisible();
  });
});

describe('card content', () => {
  it('is a region named by its heading', async () => {
    await setup(project(REAL_ACTUAL));
    const region = page.getByRole('region', { name: '1234 Mission St' });
    await expect.element(region).toBeVisible();
    await expect
      .element(page.getByRole('heading', { level: 2, name: '1234 Mission St' }))
      .toBeVisible();
  });

  it('badges a real and a simulated project', async () => {
    const real = await setup(project(REAL_ACTUAL));
    await expect.element(page.getByTestId('card-badge')).toHaveTextContent('Real project');
    await real.view.unmount();
    await setup(project(SIMULATED), { day: stageDay(SIMULATED, 'filed') + 10 });
    await expect.element(page.getByTestId('card-badge')).toHaveTextContent('Simulated project');
  });

  it('shows the in-stage status with months so far', async () => {
    await setup(project(REAL_ACTUAL), { day: stageDay(REAL_ACTUAL, 'construction') + 122 });
    await expect.element(text('Under construction, 4 months so far')).toBeVisible();
  });

  it('shows the completed status', async () => {
    const end = REAL_ACTUAL.end;
    if (end?.kind !== 'complete') throw new Error('REAL_ACTUAL must complete');
    await setup(project(REAL_ACTUAL), { day: end.day });
    await expect.element(text('Completed Nov 2027')).toBeVisible();
  });

  it('shows the stopped status', async () => {
    await setup(project(EXITED), { day: FIX_ASOF + 2000 });
    await expect
      .element(text('Stopped during In Planning review (withdrawn), Mar 2031'))
      .toBeVisible();
  });

  it('shows the simulated disclaimer on a simulated card only', async () => {
    const sim = await setup(project(SIMULATED), { day: stageDay(SIMULATED, 'filed') + 10 });
    await expect.element(text(SIMULATED_DISCLAIMER)).toBeVisible();
    await sim.view.unmount();
    await setup(project(REAL_ACTUAL));
    expect(document.body.textContent).not.toContain('Not a real proposal');
  });

  it('shows the massing notes', async () => {
    const approx = await setup(project(APPROXIMATE));
    await expect.element(text('Building shape approximate')).toBeVisible();
    await approx.view.unmount();
    const unenriched = await setup(project(UNENRICHED), { day: FIX_ASOF });
    await expect
      .element(text(/^Multi-phase project without published or estimated phases/))
      .toBeVisible();
    await unenriched.view.unmount();
    await setup(project({ ...REAL_ACTUAL, massing: 'none' }));
    await expect.element(text('Building not drawn; footprint only')).toBeVisible();
  });

  it('shows the pathway', async () => {
    await setup(project(REAL_ACTUAL));
    await expect
      .element(text('Discretionary review (Planning Commission or similar)'))
      .toBeVisible();
  });

  it('takes existing homes from the card and marks the assessor on a checked record', async () => {
    const marked = await setup(project(WITH_QUALITY));
    await expect.element(text(/replaces 0 existing homes \(assessor\*\)/)).toBeVisible();
    await marked.view.unmount();
    await setup(project(REAL_ACTUAL));
    await expect.element(text(/replaces 2 existing homes \(assessor\) /)).toBeVisible();
  });

  it('words the stories by tier', async () => {
    const t0 = await setup(project(TIER0));
    await expect.element(text(/ · 6 stories · /)).toBeVisible();
    await t0.view.unmount();
    const t3 = await setup(project(TIER3));
    await expect.element(text(/about 6 stories, from the project description/)).toBeVisible();
    await t3.view.unmount();
    await setup(project(TIER4_MASSING));
    await expect.element(text(/about 6 stories \(simulated\)/)).toBeVisible();
  });

  it('lists a later resize', async () => {
    const revised: ProjectCard = {
      ...SIMULATED,
      revisions: [
        { day: stageDay(SIMULATED, 'filed'), units: 24, stories: 6 },
        { day: stageDay(SIMULATED, 'entitled'), units: 30, stories: 8 }
      ]
    };
    await setup(project(revised), { day: stageDay(SIMULATED, 'entitled') + 1 });
    await expect.element(text(/^Resized: 24 → 30 homes, /)).toBeVisible();
  });
});

describe('source links', () => {
  it('builds hrefs from the record key, else the dataset table', async () => {
    const card: ProjectCard = {
      ...REAL_ACTUAL,
      sources: [
        ...REAL_ACTUAL.sources,
        { dataset: 'qvu5-m3a2', id: '2019-000123PRJ' },
        { dataset: 'zzzz-zzzz', id: 'X1' }
      ]
    };
    await setup(project(card));
    const href = (name: RegExp) => page.getByRole('link', { name }).element().getAttribute('href');
    expect(href(/^Development pipeline 2007\.0001PRX/)).toBe(
      'https://data.sf.gov/resource/6jgi-cpb4.json?case_no=2007.0001PRX'
    );
    expect(href(/^Building permit 201801010001/)).toBe(
      'https://data.sf.gov/resource/i98e-djp9.json?permit_number=201801010001'
    );
    expect(href(/^Planning project 2019-000123PRJ/)).toBe(
      'https://data.sf.gov/resource/qvu5-m3a2.json?record_id=2019-000123PRJ'
    );
    expect(href(/^zzzz-zzzz X1/)).toBe('https://data.sf.gov/d/zzzz-zzzz');
  });
});

describe('chance of finishing', () => {
  const day = stageDay(REAL_ACTUAL, 'construction') + 122;

  it('shows the chance from the table', async () => {
    await setup(project(REAL_ACTUAL), { day });
    const p = chance.discretionary.construction![4];
    expect(p).toBeGreaterThan(0);
    await expect.element(text(`Chance of finishing from here: ${formatChance(p)}`)).toBeVisible();
    await expect.element(text(CHANCE_EXPLANATION)).toBeVisible();
    expect(cardStatus(REAL_ACTUAL, day, chance)?.chance).toBe(p);
  });

  it('shows no chance once complete or stopped', async () => {
    await setup(project(EXITED), { day: FIX_ASOF + 2000 });
    expect(document.body.textContent).not.toContain('Chance of finishing');
  });

  it('lists the main and tail entries and links each to its section', async () => {
    const { onsource } = await setup(project(REAL_ACTUAL), { day });
    const tr = cal.transitions.discretionary.construction!;
    await page.getByText('How is this estimated?').click();
    const main = page.getByRole('button', { name: new RegExp(tr.provenance.label.slice(0, 30)) });
    await expect.element(main).toBeVisible();
    const tail = page.getByRole('button', {
      name: new RegExp(tr.tailProvenance.label.replace(/[()]/g, '\\$&'))
    });
    await expect.element(tail).toBeVisible();
    await tail.click();
    expect(onsource).toHaveBeenCalledWith('src-transition-discretionary-construction');
  });

  it('starts a Local Program project with the Local Program entry', async () => {
    const { onsource } = await setup(project(SIMULATED_LOCAL), {
      day: stageDay(SIMULATED_LOCAL, 'permitFiled') + 1
    });
    await page.getByText('How is this estimated?').click();
    const items = [...document.querySelectorAll('details li button')] as HTMLButtonElement[];
    expect(items[0].textContent).toContain(cal.streamlinedForLocalProgram.label);
    items[0].click();
    expect(onsource).toHaveBeenCalledWith('src-local-program');
  });

  it('says the number is partly research-based when a listed transition is tier 3', async () => {
    const entitledDay = stageDay(REAL_ACTUAL, 'entitled') + 10;
    const plain = await setup(project(REAL_ACTUAL), { day: entitledDay });
    expect(document.body.textContent).not.toContain('research estimates');
    await plain.view.unmount();
    await setup(project(REAL_ACTUAL), { day: entitledDay, calibration: tier3Calibration() });
    await expect
      .element(text('This is partly based on research estimates, not San Francisco records.'))
      .toBeVisible();
  });

  it('is research-based for a pre-application card under the fixture calibration', async () => {
    const card: ProjectCard = {
      ...REAL_ACTUAL,
      stages: [{ stage: 'preApplication', day: FIX_ASOF - 10, actual: true }],
      end: null
    };
    await setup(project(card));
    await expect.element(text(/partly based on research estimates/)).toBeVisible();
  });
});

describe('data notes', () => {
  it('marks a checked record and lists the notes', async () => {
    await setup(project(WITH_QUALITY));
    await expect
      .element(page.getByRole('heading', { name: "* About this record's data" }))
      .toBeVisible();
    await expect
      .element(
        text('Dates taken from the Planning record on this lot (San Francisco project records)')
      )
      .toBeVisible();
    await expect
      .element(
        text(
          'A date outside 1970 to the snapshot day was treated as missing (Assumption, not data)'
        )
      )
      .toBeVisible();
    await expect.element(text(/ · Recorded\*$/).first()).toBeVisible();
  });

  it('shows none on an unchecked record', async () => {
    await setup(project(NO_QUALITY));
    expect(document.body.textContent).not.toContain("About this record's data");
    expect(document.body.textContent).not.toContain('Recorded*');
    await expect.element(text(/ · Recorded$/).first()).toBeVisible();
  });
});

describe('phase cards', () => {
  it('shows the phase line, master context and the This phase sub-heading', async () => {
    await setup(project(PHASE_ESTIMATED), { day: FIX_ASOF });
    await expect.element(text('Phase 3 of 12, Candlestick Point')).toBeVisible();
    const items = [...document.querySelectorAll('li')].map((li) => li.textContent?.trim());
    expect(items.some((t) => /^Master plan approved · .* · Recorded$/.test(t ?? ''))).toBe(true);
    const sub = page.getByRole('heading', { name: 'This phase' }).element();
    const permit = [...document.querySelectorAll('li')].find((li) =>
      li.textContent?.startsWith('Building permit filed')
    )!;
    expect(permit.textContent).toContain('Simulated (start estimated)');
    expect(sub.compareDocumentPosition(permit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const master = [...document.querySelectorAll('li')].find((li) =>
      li.textContent?.startsWith('Master plan approved')
    )!;
    expect(sub.compareDocumentPosition(master) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });
});

describe('closing', () => {
  it('closes from the button', async () => {
    const { onclose } = await setup(project(REAL_ACTUAL));
    await page.getByRole('button', { name: 'Close' }).click();
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', async () => {
    const { onclose } = await setup(project(REAL_ACTUAL));
    await userEvent.keyboard('{Escape}');
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape while idle', async () => {
    const { onclose } = await setup({ kind: 'idle' });
    await userEvent.keyboard('{Escape}');
    expect(onclose).not.toHaveBeenCalled();
  });

  it('leaves Escape to an open modal dialog', async () => {
    const { onclose } = await setup(project(REAL_ACTUAL));
    const dialog = document.createElement('dialog');
    document.body.appendChild(dialog);
    dialog.showModal();
    await userEvent.keyboard('{Escape}');
    dialog.remove();
    expect(onclose).not.toHaveBeenCalled();
  });
});

describe('target sizes (spec §4.3)', () => {
  it('every control is at least 24x24 and carries the 44 px coarse-pointer variant', async () => {
    await page.viewport(1280, 800);
    await setup(project(REAL_ACTUAL), { day: stageDay(REAL_ACTUAL, 'construction') + 122 });
    await page.getByText('How is this estimated?').click();
    const controls = [
      ...document.querySelectorAll<HTMLElement>('section button, section summary, section a')
    ];
    // Close, the summary, the entry buttons and both source links.
    expect(controls.length).toBeGreaterThanOrEqual(6);
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      expect(r.height, el.outerHTML).toBeGreaterThanOrEqual(24);
      expect(r.width, el.outerHTML).toBeGreaterThanOrEqual(24);
      expect(
        el.className.includes('pointer-coarse:min-h-11') || el.className.includes('min-h-11'),
        el.outerHTML
      ).toBe(true);
    }
  });
});

describe('layout (spec §4.3)', () => {
  it('sits top-left at w-80 on a wide viewport', async () => {
    await page.viewport(1280, 800);
    await setup(project(REAL_ACTUAL));
    const cs = getComputedStyle(panel());
    expect(cs.position).toBe('absolute');
    expect(cs.top).toBe('16px');
    expect(cs.left).toBe('16px');
    expect(cs.width).toBe('320px');
  });

  it('is a bottom sheet clear of the map controls below 768 px', async () => {
    await page.viewport(375, 700);
    document.documentElement.style.setProperty('--map-controls-br-block-size', '100px');
    await setup(project(REAL_ACTUAL));
    const cs = getComputedStyle(panel());
    expect(cs.position).toBe('absolute');
    expect(cs.left).toBe('16px');
    expect(cs.right).toBe('16px');
    expect(cs.bottom).toBe('108px');
    expect(cs.maxHeight).toMatch(/^(50%|calc\(50%\))$/);
    expect(cs.overflowY).toBe('auto');
  });
});
