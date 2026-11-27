// The widest header strings the game's pages can show, written into the page for the header fit
// tests (layout.spec.ts and the specs of the game's screens), and the pinned goal's phone line
// measured part by part: its box clips (`overflow: hidden`), so the bar's own overflow never shows
// a clip inside it.
import { expect, type Page } from '@playwright/test';

/**
 * The pinned goal's widest words (`pinnedWords`, src/lib/game/ui/round-words.ts), measured in the
 * phone line's font (text-xs, semibold, tabular digits) on 2026-11-26:
 * - line 1 of a pending round with a target, line 2 before a round's offer;
 * - the phone line's count and its short form (shown at 13rem or less);
 * - `phoneRest`, the widest month phrase: "before May 2066", 100.9 px ("before" is a pending
 *   round's; a win's widest, "after May 2066", is 90.8 px; May is the widest month);
 * - `phoneResult`, the widest early or late phrase inside the 40-year window: two-digit years and
 *   months, 103.9 px ("10 yr 11 mo early"; "late" is narrower).
 */
export const WIDEST_PINNED = {
  line1: '82,069 homes before May 2066',
  line2: 'Beat it: 3 new policies',
  phoneCount: '82,069',
  phoneShort: '82k',
  phoneRest: 'before May 2066',
  phoneResult: '10 yr 11 mo early'
} as const;

/**
 * Writes the pinned goal's widest words into its two lines and into its phone line's parts (count,
 * short count, month and, when the state has one, the result; the homes part keeps what the state
 * put there). Text only, so a second call leaves the page as the first did.
 */
export async function widestGameHeader(page: Page): Promise<void> {
  await page.evaluate((w) => {
    const set = (sel: string, text: string) => {
      const el = document.querySelector(sel);
      if (el) el.textContent = text;
    };
    set('[data-testid="goal-line1"]', w.line1);
    set('[data-testid="goal-line2"]', w.line2);
    set('[data-testid="goal-phone"] .goal-count', w.phoneCount);
    set('[data-testid="goal-phone"] .goal-short', w.phoneShort);
    set('[data-testid="goal-phone"] .goal-rest', w.phoneRest);
    set('[data-testid="goal-phone"] .goal-result', w.phoneResult);
  }, WIDEST_PINNED);
}

/** A box as plain numbers. */
interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The pinned goal's phone line as drawn: its box and each drawn part's (count to result). */
export interface GoalLine {
  line: Box;
  parts: (Box & { c: string; text: string })[];
  /** The part that holds `word`, or null. */
  word: (Box & { c: string; text: string }) | null;
  viewport: number;
  /** The room left at the line's right, after its widest row of parts. */
  slack: number;
}

/** Measures the pinned goal's phone line; `word` names the part that must be drawn. */
export async function goalLine(page: Page, word: string): Promise<GoalLine> {
  return page.getByTestId('goal-phone').evaluate((line, w) => {
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const parts = ['count', 'short', 'homes', 'rest', 'result']
      .map((c) => ({ c, el: line.querySelector(`.goal-${c}`) }))
      .filter((p) => p.el !== null && p.el.getBoundingClientRect().width > 0)
      .map((p) => ({ c: p.c, text: p.el!.textContent ?? '', ...box(p.el!) }));
    const lineBox = box(line);
    return {
      line: lineBox,
      parts,
      word: parts.find((p) => p.text.includes(w)) ?? null,
      viewport: innerWidth,
      slack: lineBox.right - Math.max(...parts.map((p) => p.right))
    };
  }, word);
}

/** Every drawn part inside the line's box and the viewport, and the word drawn. */
export function expectGoalLineWhole(drawn: GoalLine): void {
  const why = JSON.stringify(drawn);
  for (const p of drawn.parts) {
    expect(p.left, why).toBeGreaterThanOrEqual(drawn.line.left - 0.5);
    expect(p.right, why).toBeLessThanOrEqual(drawn.line.right + 0.5);
    expect(p.top, why).toBeGreaterThanOrEqual(drawn.line.top - 0.5);
    expect(p.bottom, why).toBeLessThanOrEqual(drawn.line.bottom + 0.5);
    expect(p.right, why).toBeLessThanOrEqual(drawn.viewport);
  }
  expect(drawn.word, why).not.toBeNull();
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
