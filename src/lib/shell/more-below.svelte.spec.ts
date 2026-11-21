// The moreBelow attachment: data-more on a scroll box while its content overflows and it is not
// scrolled to within 1 px of its end. Read on scroll and on a ResizeObserver; no frame, no timer.
// The cue it drives (`.more-below` in layout.css): a fade at the foot, a line under forced colours.
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import MoreBelowHost from './test/MoreBelowHost.svelte';

const box = () => page.getByTestId('box').element() as HTMLElement;
const more = () => box().hasAttribute('data-more');

/** The declarations a `(forced-colors: active)` rule gives `.more-below[data-more]::after`. */
function forcedCue(): Record<string, string> {
  const got: Record<string, string> = {};
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const r of rules) {
      if (!(r instanceof CSSMediaRule) || !r.conditionText.includes('forced-colors: active'))
        continue;
      for (const x of r.cssRules) {
        if (!(x instanceof CSSStyleRule) || !/\.more-below.*::after/.test(x.selectorText)) continue;
        for (const p of x.style) got[p] = x.style.getPropertyValue(p);
      }
    }
  }
  return got;
}

describe('moreBelow', () => {
  it('data-more while the content overflows and is not at its end; gone at the end and when it fits', async () => {
    const r = await render(MoreBelowHost, { height: 300 });
    await expect.poll(more).toBe(true);
    box().scrollTop = 199.5;
    // Within 1 px of the end counts as the end.
    await expect.poll(more).toBe(false);
    box().scrollTop = 120;
    await expect.poll(more).toBe(true);
    box().scrollTop = 200;
    await expect.poll(more).toBe(false);
    box().scrollTop = 0;
    await expect.poll(more).toBe(true);
    await r.rerender({ height: 80 });
    await expect.poll(more).toBe(false);
  });

  it('a content change that makes it overflow sets data-more without a scroll', async () => {
    const r = await render(MoreBelowHost, { height: 80 });
    await expect.element(page.getByTestId('content')).toBeInTheDocument();
    expect(more()).toBe(false);
    await r.rerender({ height: 300 });
    await expect.poll(more).toBe(true);
    expect(box().scrollTop).toBe(0);
    // A new first child is observed too.
    await r.rerender({ height: 80 });
    await expect.poll(more).toBe(false);
    await r.rerender({ height: 80, swap: true });
    await expect.element(page.getByTestId('swapped')).toBeInTheDocument();
    await r.rerender({ height: 300, swap: true });
    await expect.poll(more).toBe(true);
  });

  it('the cue: a fade at the foot while data-more, never a press, never moving; a line under forced colours', async () => {
    await render(MoreBelowHost, { height: 300 });
    await expect.poll(more).toBe(true);
    const after = () => getComputedStyle(box(), '::after');
    expect(after().opacity).toBe('1');
    expect(after().pointerEvents).toBe('none');
    expect(after().position).toBe('sticky');
    expect(after().backgroundImage).toContain('linear-gradient');
    // Nothing moves: no animation, no transition.
    expect(after().animationName).toBe('none');
    expect(Number.parseFloat(after().transitionDuration)).toBe(0);
    box().scrollTop = 200;
    await expect.poll(more).toBe(false);
    expect(after().opacity).toBe('0');
    // Under forced colours: a 2 px CanvasText line at the foot.
    const forced = forcedCue();
    expect(forced.height).toBe('2px');
    expect(forced['background-color']).toMatch(/^canvastext$/i);
    expect(forced['background-image']).toBe('none');
    expect(forced['forced-color-adjust']).toBe('none');
  });
});
