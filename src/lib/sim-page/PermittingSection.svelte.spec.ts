/// <reference types="@vitest/browser-playwright" />
// "Permitting timelines" (sim-timers Task 4): preset picker, Save and Revert, route shares, the
// zero-share route that keeps its timeline, and Undo over each change.
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { DEFAULT_LEVERS } from '$lib/sim/levers/types';
import { parseCalibration } from '$lib/timelapse/model';
import type { Calibration } from '$lib/timelapse/types';
import fixture0CalibrationJson from '../../../e2e/fixtures/data/fixture-0/scenarios/fzp/calibration.json';
import PermittingSection from './PermittingSection.svelte';
import { policyFromLevers } from './policy';
import { PolicyStore } from './policy-store.svelte';
import { setStageMonths } from './timing';

const load = (): Calibration =>
  parseCalibration(structuredClone(fixture0CalibrationJson) as unknown);

function setup() {
  const calibration = load();
  const store = new PolicyStore(policyFromLevers(DEFAULT_LEVERS));
  const announce = vi.fn();
  void render(PermittingSection, { props: { store, calibration, announce } });
  return { store, calibration, announce };
}

const preset = () => page.getByRole('combobox', { name: 'Preset' });
const save = () => page.getByRole('button', { name: 'Save timelines' });
const revertBtn = (name: RegExp | string) => page.getByRole('button', { name });
const share = (route: string) => page.getByRole('spinbutton', { name: `${route} share, %` });
const value = (route: string) => (share(route).element() as HTMLInputElement).value;

/** A custom permit-review edit on discretionary, applied straight to the store. */
function editPermitReview(store: PolicyStore, cal: Calibration): void {
  store.apply(
    (p) => ({
      ...p,
      timing: {
        ...p.timing,
        current: setStageMonths(cal, p.timing.current, 'discretionary', 'permitFiled', 6).set
      }
    }),
    'Edited'
  );
}

describe('PermittingSection', () => {
  it('lists only available presets', async () => {
    setup();
    await expect.element(preset()).toBeVisible();
    const select = preset().element() as unknown as HTMLSelectElement;
    const names = [...select.options].map((o) => o.text);
    expect(names).toContain("Permits at San Diego's pace");
    expect(names).toContain('SF as observed');
    expect(names.some((n) => n.startsWith('CEQA'))).toBe(false);
  });

  it('choosing a preset sets the preset and the label, keeping nothing else', async () => {
    const { store, announce } = setup();
    await preset().selectOptions("Permits at San Diego's pace");
    expect(store.policy.timing.current.preset).toBe('benchmarkPermits');
    expect(store.undoLabel).toBe("Timelines: Permits at San Diego's pace");
    await expect
      .element(page.getByTestId('timing-label'))
      .toHaveTextContent("Permits at San Diego's pace");
    expect(announce).toHaveBeenCalledWith("Timelines: Permits at San Diego's pace");
  });

  it('Undo restores edits a preset replaced', async () => {
    const { store, calibration } = setup();
    editPermitReview(store, calibration);
    const edited = store.policy.timing.current;
    expect(edited.edits.length).toBe(1);
    await preset().selectOptions("Permits at San Diego's pace");
    expect(store.policy.timing.current.edits).toEqual([]);
    store.undo();
    expect(store.policy.timing.current).toEqual(edited);
  });

  it('Save, then a preset change, then Revert gives back the saved set', async () => {
    const { store, announce } = setup();
    await preset().selectOptions("Permits at San Diego's pace");
    const set = store.policy.timing.current;
    await save().click();
    expect(store.policy.timing.saved).toEqual({ label: "Permits at San Diego's pace", set });
    expect(announce).toHaveBeenCalledWith('Saved timelines');
    await preset().selectOptions('No discretionary review');
    expect(store.policy.timing.saved?.set).toEqual(set);
    const rev = revertBtn('Revert to saved');
    await expect.element(rev).toBeEnabled();
    await expect
      .element(rev)
      .toHaveAccessibleDescription("Restores the saved timelines: Permits at San Diego's pace");
    await rev.click();
    expect(store.policy.timing.current).toEqual(set);
    await expect.element(rev).toBeDisabled();
  });

  it("without a save, Revert after an edit gives the preset's set", async () => {
    const { store, calibration } = setup();
    await preset().selectOptions("Permits at San Diego's pace");
    const set = store.policy.timing.current;
    editPermitReview(store, calibration);
    const rev = revertBtn("Revert to Permits at San Diego's pace");
    await expect.element(rev).toBeEnabled();
    await rev.click();
    expect(store.policy.timing.current).toEqual(set);
    expect(store.undoLabel).toBe("Reverted to Permits at San Diego's pace");
  });

  it('Revert is disabled on an unedited preset with no save', async () => {
    setup();
    await expect.element(revertBtn('Revert to SF as observed')).toBeDisabled();
    await expect.element(save()).toBeDisabled();
  });

  it('shares always sum to 100', async () => {
    const { announce } = setup();
    const input = share('Permit only');
    await input.fill('100');
    input.element().dispatchEvent(new Event('change', { bubbles: true }));
    await expect.poll(() => value('Discretionary')).toBe('0');
    expect(value('Streamlined')).toBe('0');
    expect(value('Permit only')).toBe('100');
    expect(announce).toHaveBeenCalledWith(
      'Shares now: discretionary 0 %, streamlined 0 %, permit only 100 %'
    );
  });

  it('an empty share restores the shown value and changes nothing', async () => {
    const { store } = setup();
    const before = value('Streamlined');
    await share('Streamlined').fill('');
    share('Streamlined')
      .element()
      .dispatchEvent(new Event('change', { bubbles: true }));
    await expect.poll(() => value('Streamlined')).toBe(before);
    expect(store.canUndo).toBe(false);
  });

  it('a zero-share route keeps its timeline', async () => {
    setup();
    const input = share('Discretionary');
    await input.fill('0');
    input.element().dispatchEvent(new Event('change', { bubbles: true }));
    await expect.poll(() => value('Discretionary')).toBe('0');
    const block = page.getByRole('group', { name: 'Discretionary timeline' });
    await expect.element(block.getByText(/Permit review/)).toBeVisible();
  });

  it('shows the Local Program line', async () => {
    setup();
    await expect
      .element(
        page.getByText('Family Zoning Plan Local Program lots use the streamlined route.', {
          exact: true
        })
      )
      .toBeVisible();
  });
});
