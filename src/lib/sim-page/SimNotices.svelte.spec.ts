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
