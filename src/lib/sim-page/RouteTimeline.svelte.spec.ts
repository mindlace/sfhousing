/// <reference types="@vitest/browser-playwright" />
// One route's editable timeline (sim-timers Task 5): segments with roving focus, the stage details
// editor, drag handles on a fine pointer only, bounds that stop and say so, and target sizes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { DEFAULT_LEVERS } from '$lib/sim/levers/types';
import { parseCalibration } from '$lib/timelapse/model';
import type { Calibration, Pathway } from '$lib/timelapse/types';
import fixture0CalibrationJson from '../../../e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json';
import PermittingSection from './PermittingSection.svelte';
import { policyFromLevers } from './policy';
import { PolicyStore } from './policy-store.svelte';
import RouteTimeline from './RouteTimeline.svelte';
import { resolvePreset, setStageMonths, stageBounds } from './timing';

const load = (): Calibration =>
  parseCalibration(structuredClone(fixture0CalibrationJson) as unknown);

/** Emulates `(pointer: fine)` or `(pointer: coarse)` for the components' media queries. */
function emulatePointer(fine: boolean): void {
  const real = window.matchMedia.bind(window);
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
    if (!query.includes('pointer')) return real(query);
    const matches = query.includes('fine') ? fine : query.includes('coarse') ? !fine : false;
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false
    } as MediaQueryList;
  });
}

function setup(
  pathway: Pathway = 'discretionary',
  fine = true,
  tweak: (c: Calibration) => void = () => {}
) {
  emulatePointer(fine);
  const calibration = load();
  tweak(calibration);
  const store = new PolicyStore(policyFromLevers(DEFAULT_LEVERS));
  const announce = vi.fn();
  void render(RouteTimeline, { props: { store, calibration, pathway, announce } });
  return { store, calibration, announce };
}

const bar = (route = 'Discretionary') => page.getByRole('group', { name: `${route} timeline` });
const segments = () => bar().getByRole('button').elements() as HTMLButtonElement[];
const segment = (name: RegExp) => bar().getByRole('button', { name });
const months = () => page.getByRole('spinbutton', { name: 'Typical months' });
const handle = (stage: string) =>
  document.querySelector<HTMLElement>(`[data-testid="handle-${stage}"]`);

function pointer(el: Element, type: string, clientX: number, clientY: number): void {
  el.dispatchEvent(
    new PointerEvent(type, {
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX,
      clientY,
      bubbles: true,
      cancelable: true
    })
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each([768, 375])('RouteTimeline at %i px', (width) => {
  it('renders the stages in pathway order, with the locked ones named so', async () => {
    await page.viewport(width, 900);
    setup();
    await expect.element(bar()).toBeVisible();
    const names = segments().map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual([
      'Pre-application, 6 months, 86% move on',
      'Filed to entitled, 9 months, 97% move on',
      'Entitled to permit filed, 4 months, 90% move on, locked',
      'Permit review, 7 months, 94% move on',
      'Permit issued to construction start, 3 months, 70% move on',
      'Construction, 30 months, 96% move on, locked'
    ]);
  });

  it('permit only has four segments', async () => {
    await page.viewport(width, 900);
    setup('permitOnly');
    await expect.element(bar('Permit only')).toBeVisible();
    const names = (bar('Permit only').getByRole('button').elements() as HTMLElement[]).map((b) =>
      b.getAttribute('aria-label')
    );
    expect(names.map((n) => n?.split(',')[0])).toEqual([
      'Pre-application',
      'Permit review',
      'Permit issued to construction start',
      'Construction'
    ]);
  });

  it('moves with the arrow keys, opens details with Enter and coalesces + presses', async () => {
    await page.viewport(width, 900);
    const { store } = setup();
    await expect.element(bar()).toBeVisible();
    const all = segments();
    expect(all.map((b) => b.tabIndex)).toEqual([0, -1, -1, -1, -1, -1]);
    all[0].focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(all[1]);
    await userEvent.keyboard('{End}');
    expect(document.activeElement).toBe(all[5]);
    await userEvent.keyboard('{Home}');
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(all[3]);
    expect(all[3].tabIndex).toBe(0);
    await userEvent.keyboard('{Enter}');
    await expect.element(segment(/^Permit review/)).toHaveAttribute('aria-expanded', 'true');
    const details = document.getElementById(all[3].getAttribute('aria-controls')!);
    expect(details).not.toBeNull();
    await expect.element(months()).toHaveValue(7);
    const plus = page.getByRole('button', { name: 'Lengthen by 0.5 month' });
    await plus.click();
    await expect.element(months()).toHaveValue(7.5);
    expect(store.policy.timing.current.edits).toHaveLength(1);
    expect(store.undoLabel).toBe('Permit review, discretionary to 7.5 months');
    for (let i = 0; i < 9; i++) await plus.click();
    await expect.element(months()).toHaveValue(12);
    expect(store.undoLabel).toBe('Permit review, discretionary to 12 months');
    store.undo();
    expect(store.canUndo).toBe(false);
    expect(store.policy.timing.current.edits).toEqual([]);
  });

  it('a drag past the minimum stops and says so', async () => {
    await page.viewport(width, 900);
    const { store, calibration, announce } = setup();
    await expect.element(bar()).toBeVisible();
    const h = handle('permitFiled');
    expect(h).not.toBeNull();
    expect(h!.getAttribute('aria-hidden')).toBe('true');
    const r = h!.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    pointer(h!, 'pointerdown', x, y);
    pointer(h!, 'pointermove', x - 2000, y);
    await expect.element(page.getByTestId('bound-permitFiled')).toHaveTextContent('min');
    expect(store.canUndo).toBe(false);
    pointer(h!, 'pointerup', x - 2000, y);
    const b = stageBounds(calibration, store.policy.timing.current, 'discretionary', 'permitFiled');
    const edits = store.policy.timing.current.edits;
    expect(edits).toHaveLength(1);
    const typical0 = 7;
    expect(edits[0].scale * typical0).toBeCloseTo(b.min, 6);
    await expect
      .element(segment(/^Permit review/))
      .toHaveAttribute('aria-label', expect.stringMatching(/at the minimum$/));
    expect(announce).toHaveBeenCalledWith(
      expect.stringMatching(/^Reached the minimum for Permit review: /)
    );
    expect(store.undoLabel).toBe(`Permit review, discretionary to ${b.min} month`);
  });

  it('losing the pointer capture mid-drag drops the preview and commits nothing', async () => {
    await page.viewport(width, 900);
    const { store, announce } = setup();
    await expect.element(bar()).toBeVisible();
    const h = handle('permitFiled')!;
    const r = h.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    pointer(h, 'pointerdown', x, y);
    pointer(h, 'pointermove', x - 2000, y);
    await expect.element(page.getByTestId('bound-permitFiled')).toBeInTheDocument();
    pointer(h, 'lostpointercapture', x - 2000, y);
    await expect.element(page.getByTestId('bound-permitFiled')).not.toBeInTheDocument();
    await expect
      .element(segment(/^Permit review/))
      .toHaveAttribute('aria-label', 'Permit review, 7 months, 94% move on');
    // A later pointer-up (the drag is over) commits nothing either.
    pointer(h, 'pointerup', x - 2000, y);
    expect(store.canUndo).toBe(false);
    expect(store.policy.timing.current.edits).toEqual([]);
    expect(announce).not.toHaveBeenCalled();
  });

  it('typing above the maximum commits the maximum and says so', async () => {
    await page.viewport(width, 900);
    const { store, calibration, announce } = setup();
    await segment(/^Permit review/).click();
    const b = stageBounds(calibration, store.policy.timing.current, 'discretionary', 'permitFiled');
    await expect.element(months()).toHaveAttribute('max', String(b.max));
    await expect.element(months()).toHaveAttribute('min', String(b.min));
    await months().fill('500');
    months()
      .element()
      .dispatchEvent(new Event('change', { bubbles: true }));
    await expect.element(months()).toHaveValue(b.max);
    expect(store.policy.timing.current.edits[0].scale * 7).toBeCloseTo(b.max, 6);
    expect(announce).toHaveBeenCalledWith(`Reached the maximum for Permit review: ${b.max} months`);
    await expect
      .element(page.getByRole('button', { name: 'Lengthen by 0.5 month' }))
      .toHaveAttribute('aria-disabled', 'true');
  });

  it('an empty entry restores the shown value and changes nothing', async () => {
    await page.viewport(width, 900);
    const { store } = setup();
    await segment(/^Permit review/).click();
    await months().fill('');
    months()
      .element()
      .dispatchEvent(new Event('change', { bubbles: true }));
    await expect.element(months()).toHaveValue(7);
    expect(store.canUndo).toBe(false);
  });

  it('a coarse pointer gets no handles, and the details still edit (2.5.7)', async () => {
    await page.viewport(width, 900);
    const { store } = setup('discretionary', false);
    await expect.element(bar()).toBeVisible();
    expect(document.querySelector('[data-testid^="handle-"]')).toBeNull();
    await segment(/^Permit review/).click();
    await months().fill('5');
    months()
      .element()
      .dispatchEvent(new Event('change', { bubbles: true }));
    await expect.element(segment(/^Permit review, 5 months/)).toBeInTheDocument();
    expect(store.policy.timing.current.edits).toHaveLength(1);
  });

  it('a locked stage shows its reason and no editor', async () => {
    await page.viewport(width, 900);
    setup();
    await segment(/^Construction/).click();
    await expect
      .element(page.getByText('Set mostly by the builder, financing and technology'))
      .toBeVisible();
    await expect.element(months()).not.toBeInTheDocument();
  });

  it('the details give days, minimum, chances, reach and sources', async () => {
    await page.viewport(width, 900);
    const { store, calibration } = setup();
    await segment(/^Permit review/).click();
    await expect.element(page.getByText('≈ 213 days')).toBeVisible();
    await expect
      .element(page.getByText(/^Minimum: 1 month \(Minimum permit review: .*, tier \d\)$/))
      .toBeVisible();
    await expect
      .element(page.getByText('Of projects in this stage, 94% move on; 6% withdrawn'))
      .toBeVisible();
    await expect.element(page.getByText(/^Applies to/)).not.toBeInTheDocument();
    // An edit reaches every project.
    await page.getByRole('button', { name: 'Shorten by 0.5 month' }).click();
    await expect
      .element(page.getByText('Applies to every project, including those already in this stage'))
      .toBeVisible();
    // A stage with no sourced floor says so.
    await segment(/^Permit issued/).click();
    await expect.element(page.getByText('No sourced minimum; numerical limit ×0.05')).toBeVisible();
    expect(store.policy.timing.current.edits).toHaveLength(1);
    expect(calibration.transitions.discretionary.permitFiled).toBeDefined();
  });
});

describe('RouteTimeline sources and notes (final review I1, I2)', () => {
  const link = (name: string) => page.getByRole('link', { name, exact: true });

  it("an unedited stage cites the calibration's own table, with links", async () => {
    const { calibration } = setup();
    await segment(/^Permit review/).click();
    const prov = calibration.transitions.discretionary.permitFiled!.provenance;
    await expect.element(page.getByText(`${prov.label} (tier ${prov.tier})`)).toBeVisible();
    await expect
      .element(link('SF building permits (DataSF i98e-djp9)'))
      .toHaveAttribute('href', 'https://data.sf.gov/d/i98e-djp9');
    await expect
      .element(page.getByText(/^SF as observed: the calibration/))
      .not.toBeInTheDocument();
    // A locked stage carries its source too.
    await segment(/^Construction/).click();
    await expect
      .element(link('SF housing unit completions (DataSF j67f-aayr)'))
      .toHaveAttribute('href', 'https://data.sf.gov/d/j67f-aayr');
  });

  it('an edited stage says the value is the user’s own and keeps the observed source', async () => {
    const { calibration } = setup();
    await segment(/^Permit review/).click();
    await page.getByRole('button', { name: 'Shorten by 0.5 month' }).click();
    await expect
      .element(page.getByText('Your value: 6.5 months (custom, not sourced). Observed: 7 months.'))
      .toBeVisible();
    const prov = calibration.transitions.discretionary.permitFiled!.provenance;
    await expect.element(page.getByText('Observed source:')).toBeVisible();
    await expect.element(page.getByText(`${prov.label} (tier ${prov.tier})`)).toBeVisible();
    await expect.element(page.getByText('Sources:', { exact: true })).not.toBeInTheDocument();
  });

  it("a stage a preset sets cites the preset's sources", async () => {
    const { store, calibration } = setup();
    store.apply(
      (p) => ({
        ...p,
        timing: { ...p.timing, current: resolvePreset('benchmarkPermits', calibration) }
      }),
      'Preset'
    );
    await segment(/^Permit review/).click();
    await expect
      .element(page.getByText("Applying San Diego's permit pace to SF permit review (tier 2)"))
      .toBeVisible();
  });

  it('pre-application says no new project starts there, dated from ppaShare', async () => {
    setup();
    await segment(/^Pre-application/).click();
    await expect
      .element(
        page.getByText(
          'In the records, no new project starts here since July 2023. ' +
            'A change here reaches only projects already at this stage.'
        )
      )
      .toBeVisible();
  });

  it('the pre-application note has no date without a window', async () => {
    setup('discretionary', true, (c) => {
      delete c.ppaShare.provenance.window;
    });
    await segment(/^Pre-application/).click();
    await expect
      .element(page.getByText(/^In the records, no new project starts here\. /))
      .toBeVisible();
  });

  it('no pre-application note when new projects start there', async () => {
    setup('discretionary', true, (c) => {
      c.ppaShare.discretionary = 0.1;
    });
    await segment(/^Pre-application/).click();
    await expect.element(page.getByText(/^Of projects in this stage/)).toBeVisible();
    await expect.element(page.getByText(/^In the records, no new project/)).not.toBeInTheDocument();
  });
});

describe('RouteTimeline in the section', () => {
  it('every handle and segment box is at least 24 × 24 px (2.5.8)', async () => {
    await page.viewport(375, 900);
    emulatePointer(true);
    const store = new PolicyStore(policyFromLevers(DEFAULT_LEVERS));
    void render(PermittingSection, { props: { store, calibration: load(), announce: vi.fn() } });
    await expect.element(bar('Permit only')).toBeVisible();
    const boxes = [
      ...document.querySelectorAll('[data-testid^="handle-"]'),
      ...document.querySelectorAll('[role="group"][aria-label$=" timeline"] button')
    ];
    expect(document.querySelectorAll('[data-testid^="handle-"]').length).toBe(11);
    expect(boxes.length).toBe(16 + 11);
    for (const el of boxes) {
      const r = el.getBoundingClientRect();
      expect(r.width).toBeGreaterThanOrEqual(24);
      expect(r.height).toBeGreaterThanOrEqual(24);
    }
  });

  it('a bound badge on a 24 px segment is drawn whole, not clipped', async () => {
    await page.viewport(375, 900);
    const { store, calibration } = setup();
    store.apply(
      (p) => ({
        ...p,
        timing: {
          ...p.timing,
          current: setStageMonths(calibration, p.timing.current, 'discretionary', 'permitFiled', 0)
            .set
        }
      }),
      'To the minimum'
    );
    await expect
      .element(segment(/^Permit review/))
      .toHaveAttribute('aria-label', expect.stringMatching(/at the minimum$/));
    const seg = segment(/^Permit review/)
      .element()
      .getBoundingClientRect();
    expect(seg.width).toBeCloseTo(24, 0);
    const badge = page.getByTestId('bound-permitFiled').element() as HTMLElement;
    expect(badge.textContent).toBe('min');
    const b = badge.getBoundingClientRect();
    expect(b.width).toBeGreaterThan(0);
    expect(b.height).toBeGreaterThan(0);
    // Its text is not cut by its own box, and no clipping ancestor cuts the box.
    expect(badge.scrollWidth).toBeLessThanOrEqual(badge.clientWidth);
    for (let el = badge.parentElement; el; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const a = el.getBoundingClientRect();
      expect(b.left).toBeGreaterThanOrEqual(a.left);
      expect(b.right).toBeLessThanOrEqual(a.right);
      expect(b.top).toBeGreaterThanOrEqual(a.top);
      expect(b.bottom).toBeLessThanOrEqual(a.bottom);
    }
    // It sits over its segment.
    expect(b.left).toBeGreaterThanOrEqual(seg.left);
    expect(b.right).toBeLessThanOrEqual(seg.right);
  });

  it('has no horizontal overflow at 375 px, details open', async () => {
    await page.viewport(375, 900);
    emulatePointer(true);
    const store = new PolicyStore(policyFromLevers(DEFAULT_LEVERS));
    const view = await render(PermittingSection, {
      props: { store, calibration: load(), announce: vi.fn() }
    });
    await bar()
      .getByRole('button', { name: /^Permit review/ })
      .click();
    await expect.element(months()).toBeVisible();
    const root = document.documentElement;
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
    const section = view.container.firstElementChild as HTMLElement;
    expect(section.scrollWidth).toBeLessThanOrEqual(section.clientWidth);
  });
});
