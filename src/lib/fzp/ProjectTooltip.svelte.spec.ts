/// <reference types="@vitest/browser-playwright" />
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { EXITED, FIX_ASOF, REAL_ACTUAL, SIMULATED } from './fixtures/cards';
import ProjectTooltip from './ProjectTooltip.svelte';
import { SUMMARY_COPY, type SummaryState } from './summary-request';

const tip = () => page.getByRole('tooltip');

async function show(state: SummaryState, day = FIX_ASOF, x = 100, y = 120) {
  await page.viewport(1280, 800);
  return render(ProjectTooltip, { props: { state, day, x, y } });
}

describe('ProjectTooltip', () => {
  it('shows the label and a real project line', async () => {
    await show({ kind: 'project', card: REAL_ACTUAL });
    await expect.element(tip()).toBeVisible();
    await expect.element(tip()).toHaveTextContent('1234 Mission St');
    await expect.element(tip()).toHaveTextContent('Real project · Under construction · 24 homes');
  });

  it('says simulated for a simulated project', async () => {
    await show({ kind: 'project', card: SIMULATED }, SIMULATED.stages[0].day + 5);
    await expect
      .element(tip())
      .toHaveTextContent('Simulated project · In Planning review · 24 homes');
  });

  it('says a stopped project stopped', async () => {
    await show({ kind: 'project', card: EXITED }, FIX_ASOF + 2000);
    await expect
      .element(tip())
      .toHaveTextContent('Simulated project · Stopped: In Planning review · 24 homes');
  });

  it.each(['loading', 'not-loaded', 'none', 'unavailable'] as const)(
    'shows the %s copy',
    async (kind) => {
      await show({ kind });
      await expect.element(tip()).toHaveTextContent(SUMMARY_COPY[kind]);
    }
  );

  it('shows nothing while idle', async () => {
    await show({ kind: 'idle' });
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('is not interactive and sits 12 px from the pointer', async () => {
    await show({ kind: 'loading' }, FIX_ASOF, 100, 120);
    const el = tip().element() as HTMLElement;
    expect(el.classList.contains('sim-map-panel')).toBe(true);
    expect(getComputedStyle(el).pointerEvents).toBe('none');
    expect(el.style.left).toBe('112px');
    expect(el.style.top).toBe('132px');
  });
});
