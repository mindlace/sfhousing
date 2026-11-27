// The widest header strings the game's pages can show, written into the page for the header fit
// tests (layout.spec.ts and the specs of the game's screens).
import type { Page } from '@playwright/test';

/** The pinned goal's widest words: line 1 of a pending round, line 2 before a round's offer. */
export const WIDEST_PINNED = {
  line1: '82,069 homes before Sep 2066',
  line2: 'Beat it: 3 new policies'
} as const;

/**
 * Writes the pinned goal's widest words into its two lines. Text only, so a second call leaves the
 * page as the first did.
 */
export async function widestGameHeader(page: Page): Promise<void> {
  await page.evaluate((w) => {
    const line1 = document.querySelector('[data-testid="goal-line1"]');
    if (line1) line1.textContent = w.line1;
    const line2 = document.querySelector('[data-testid="goal-line2"]');
    if (line2) line2.textContent = w.line2;
  }, WIDEST_PINNED);
}

/**
 * The widest header strings the page can show. The save state's sizer (it reserves the width of
 * "Saving…") takes the shape of the "Autosave off" button, built from the button's own classes;
 * the score's count is the button's first text node; line 2 reads "+12,345 from your policy ·
 * Goal reached, Mar 2043". With nothing in force line 2 has no effect part, so the helper adds
 * one as the component draws it (the goal then drops from lg to xl), and removes its own copy
 * before it runs again.
 */
export async function widestHeaderText(page: Page): Promise<void> {
  await page.evaluate(() => {
    const sizer = document.querySelector(
      '[data-testid="save-state"] > span[aria-hidden="true"]:first-child'
    );
    if (sizer) {
      const chip = document.createElement('span');
      chip.className =
        'inline-flex min-h-6 min-w-6 items-center rounded-full border px-2 whitespace-nowrap';
      chip.textContent = 'Autosave off';
      sizer.replaceChildren(chip);
    }
    for (const el of document.querySelectorAll('[data-widest]')) el.remove();
    const detail = document.querySelector('[data-testid="score-detail"]');
    const goal = document.querySelector('[data-testid="score-goal"]');
    if (detail && goal && !detail.querySelector('[data-testid="score-delta"]')) {
      const added = document.createElement('span');
      added.dataset.testid = 'score-delta';
      added.dataset.widest = '';
      const sep = document.createElement('span');
      sep.className = 'lg:max-xl:hidden';
      sep.dataset.widest = '';
      sep.textContent = ' · ';
      detail.insertBefore(sep, detail.firstChild);
      detail.insertBefore(added, sep);
      goal.classList.add('lg:max-xl:hidden');
    }
    const delta = document.querySelector('[data-testid="score-delta"]');
    if (delta) delta.textContent = '+12,345 from your policy';
    if (goal) goal.textContent = 'Goal reached, Mar 2043';
    const score = document.querySelector('[data-testid="score-bar"]');
    if (!score) return;
    for (const n of score.childNodes)
      if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) {
        n.textContent = '12,345 homes by Mar 2066';
        break;
      }
  });
}
