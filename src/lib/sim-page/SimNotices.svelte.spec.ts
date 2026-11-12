/// <reference types="@vitest/browser-playwright" />
// SimNotices (T5-M2): the polite status region is in the document empty before its notices are
// inserted, so a notice present on load is announced (a live region that mounts already
// populated is not).
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import SimNotices from './SimNotices.svelte';
import type { SimNotice } from './sim-session';

const notices: SimNotice[] = [{ id: 'timing', text: 'Timelines were re-fit.', tone: 'info' }];

describe('SimNotices live region', () => {
  it('mounts empty, then fills with the notices present on load', async () => {
    const seen: number[] = [];
    const observer = new MutationObserver(() => {
      const r = document.querySelector('[data-testid="sim-notices"]');
      if (r) seen.push(r.childElementCount);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    render(SimNotices, { props: { notices, ondismiss: () => {} } });
    const region = page.getByTestId('sim-notices');
    await expect.element(region).toHaveAttribute('role', 'status');
    await expect
      .element(page.getByRole('status').getByText('Timelines were re-fit.'))
      .toBeInTheDocument();
    observer.disconnect();
    // The first state the region was seen in was empty; a later one held the notice.
    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(1);
  });
});

describe('SimNotices funding-dropped', () => {
  it('Details lists one line per dropped item', async () => {
    const details = ['Change to a from July 2028: removed (x)', 'Grant: removed (y)'];
    render(SimNotices, {
      props: {
        notices: [
          { id: 'funding-dropped', text: 'Some changes were removed.', details, tone: 'info' }
        ],
        ondismiss: () => {}
      }
    });
    await expect.element(page.getByText('Some changes were removed.')).toBeInTheDocument();
    await page.getByText('Details').click();
    for (const line of details) await expect.element(page.getByText(line)).toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid="sim-notices"] li')).toHaveLength(2);
  });
});
