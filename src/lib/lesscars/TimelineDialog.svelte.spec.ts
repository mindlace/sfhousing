/// <reference types="@vitest/browser-playwright" />
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { LESSCARS_FORMAT, parsePlanFile } from '$lib/data/lesscars/codec';
import { parseLessCarsPlan } from '$lib/data/lesscars/plan';
import { LESSCARS_START, schedulePlan } from '$lib/data/lesscars/schedule';
import livePlanJson from '../../../pipeline/enrichment/lesscars/plan.json';
import { formatShortMonthYear } from '$lib/fzp/format';
import planJson from '../../../e2e/fixtures/data/fixture-0/scenarios/lesscars/plan.json';
import TimelineDialog from './TimelineDialog.svelte';
import { GROUP_LABEL } from './timeline-view';

const planFile = parsePlanFile(planJson);

async function open(extra: Partial<{ plan: typeof planFile }> = {}) {
  const onevidence = vi.fn();
  const r = await render(TimelineDialog, {
    props: { plan: planFile, day: LESSCARS_START, onevidence, ...extra }
  });
  (r.component as unknown as { show: () => void }).show();
  return onevidence;
}

const livePlan = parseLessCarsPlan(livePlanJson);
const liveFile: typeof planFile = {
  format: LESSCARS_FORMAT,
  datasetVersion: 'live',
  plan: livePlan,
  times: [...schedulePlan(livePlan).times.values()],
  segments: {}
};

describe('TimelineDialog', () => {
  it('at 375 px the live plan timeline has no horizontal overflow; 46 parking rows sit in the disclosure', async () => {
    await page.viewport(375, 812);
    await open({ plan: liveFile });
    const dialog = page.getByTestId('lc-timeline').element();
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
    await expect.element(page.getByText('Parking at Geary Blvd becomes homes')).not.toBeVisible();
    await page.getByText(/^Parking conversions \(46\)/).click();
    const rows = [...document.querySelectorAll('details tbody tr')];
    expect(rows).toHaveLength(46);
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
    const longest = rows.reduce((a, b) =>
      (b.querySelector('th')?.textContent ?? '').length >
      (a.querySelector('th')?.textContent ?? '').length
        ? b
        : a
    );
    const label = longest.querySelector('th')!.getBoundingClientRect();
    expect(label.right).toBeLessThanOrEqual(dialog.getBoundingClientRect().right);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
  });

  it('lists every project with its dates and opens evidence for one', async () => {
    await page.viewport(1024, 768);
    const onevidence = await open();
    const hwy = planFile.plan.projects.find((p) => p.id === 'hwy')!;
    await expect.element(page.getByRole('dialog', { name: 'Project timeline' })).toBeVisible();
    await expect.element(page.getByRole('table', { name: GROUP_LABEL.transit })).toBeVisible();
    for (const p of planFile.plan.projects)
      await expect
        .element(page.getByRole('row', { name: new RegExp(p.label) }))
        .toBeInTheDocument();
    await page.getByRole('button', { name: `Evidence for ${hwy.label}` }).click();
    expect(onevidence).toHaveBeenCalledWith('hwy');
  });

  it('Close dismisses the dialog', async () => {
    await page.viewport(375, 700);
    await open();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect.element(page.getByTestId('lc-timeline')).not.toBeVisible();
  });

  it("shows each row's start, open and build months, and a dash with no build", async () => {
    await page.viewport(1024, 768);
    await open();
    const times = planFile.times;
    expect(times.some((t) => t.build)).toBe(true);
    expect(times.some((t) => !t.build)).toBe(true);
    for (const p of planFile.plan.projects) {
      const t = times.find((x) => x.id === p.id)!;
      const row = page.getByRole('row', { name: new RegExp(p.label) });
      await expect.element(row).toHaveTextContent(formatShortMonthYear(t.startDay));
      await expect.element(row).toHaveTextContent(formatShortMonthYear(t.openDay));
      if (t.build) {
        const span = `${formatShortMonthYear(t.build.startDay)} to ${formatShortMonthYear(t.build.completeDay)}`;
        await expect.element(row).toHaveTextContent(span);
      } else await expect.element(row).toHaveTextContent('—');
    }
  });

  it('keeps a short parking-conversion list open, not in a disclosure', async () => {
    await page.viewport(1024, 768);
    await open();
    const table = page.getByRole('table', { name: GROUP_LABEL.housing });
    await expect.element(table).toBeVisible();
    expect(table.element().closest('details')).toBeNull();
  });

  it('puts a long parking-conversion list inside a disclosure', async () => {
    await page.viewport(1024, 768);
    const plan = structuredClone(planFile);
    const base = plan.plan.projects.find((p) => p.kind === 'parking-conversion')!;
    for (let i = 0; i < 7; i++) {
      const id = `pc${i}`;
      plan.plan.projects.push({ ...structuredClone(base), id, label: `Lot ${id}` });
      plan.times.push({ ...plan.times.find((t) => t.id === base.id)!, id });
    }
    const n = plan.plan.projects.filter((p) => p.kind === 'parking-conversion').length;
    await open({ plan });
    await expect.element(page.getByText(`Parking conversions (${n})`)).toBeVisible();
    // A closed <details> hides its table from the accessibility tree, so find it in the DOM.
    const table = document.querySelector('details table')!;
    expect(table.querySelector('caption')?.textContent).toBe(GROUP_LABEL.housing);
    expect(table.checkVisibility()).toBe(false);
    await page.getByText(`Parking conversions (${n})`).click();
    expect(table.checkVisibility()).toBe(true);
    await expect.element(page.getByRole('table', { name: GROUP_LABEL.housing })).toBeVisible();
  });
});
