/// <reference types="@vitest/browser-playwright" />
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { parsePlanFile, parseSummary } from '$lib/data/lesscars/codec';
import { TIER_LABEL } from '$lib/fzp/labels';
import planJson from '../../../e2e/fixtures/data/fixture-0/scenarios/lesscars/plan.json';
import summaryJson from '../../../e2e/fixtures/data/fixture-0/scenarios/lesscars/summary.json';
import EvidenceDialog from './EvidenceDialog.svelte';
import { evidenceSectionId, evidenceSections } from './evidence';
import { KIND_LABEL } from './timeline-view';

const planFile = parsePlanFile(planJson);
const summary = parseSummary(summaryJson);

async function mount() {
  const r = await render(EvidenceDialog, { props: { plan: planFile, summary } });
  return r.component as unknown as { show: (id?: string) => void };
}

describe('EvidenceDialog', () => {
  it('show(id) opens on that project and focuses its heading', async () => {
    await page.viewport(1024, 768);
    const dialog = await mount();
    const hwy = planFile.plan.projects.find((p) => p.id === 'hwy')!;
    dialog.show(evidenceSectionId('hwy'));
    await expect
      .element(page.getByRole('dialog', { name: 'Evidence for every number' }))
      .toBeVisible();
    await expect
      .element(page.getByRole('heading', { name: `${hwy.label} (${KIND_LABEL[hwy.kind]})` }))
      .toHaveFocus();
    await expect.element(page.getByText('Invented').first()).toBeVisible();
  });

  it('renders tier labels, sources and the intro text', async () => {
    await page.viewport(375, 700);
    const dialog = await mount();
    dialog.show();
    const rows = evidenceSections(planFile, summary).flatMap((s) => s.rows);
    const inv = rows.find((r) => r.invented)!;
    const sourced = rows.find((r) => r.prov.sources.length > 0)!;
    const d = page.getByTestId('lc-evidence');
    await expect.element(d).toHaveTextContent(TIER_LABEL[4]);
    await expect.element(d).toHaveTextContent(inv.prov.label);
    await expect.element(d).toHaveTextContent(sourced.prov.sources[0].label);
    await expect.element(d).toHaveTextContent("Numbers marked 'Assumption, not data' are invented");
    const link = d.element().querySelector(`a[href="${sourced.prov.sources[0].url}"]`);
    expect(link).not.toBeNull();
  });

  it('Close dismisses the dialog', async () => {
    await page.viewport(1024, 768);
    const dialog = await mount();
    dialog.show();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect.element(page.getByTestId('lc-evidence')).not.toBeVisible();
  });
});
