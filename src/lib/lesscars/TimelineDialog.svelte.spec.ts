/// <reference types="@vitest/browser-playwright" />
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { parsePlanFile } from '$lib/data/lesscars/codec';
import { LESSCARS_START } from '$lib/data/lesscars/schedule';
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

describe('TimelineDialog', () => {
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
  });
});
