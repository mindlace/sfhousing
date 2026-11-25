import type { Page } from '@playwright/test';

/**
 * Makes the page a touch laptop before it loads: the primary pointer stays the desktop's fine one,
 * and `(any-pointer: coarse)` matches as a touch screen beside it would. Chromium cannot emulate
 * that pair (`hasTouch` makes the primary pointer coarse too), so the query is answered in the
 * page. The simulation's header then shows Undo and Redo.
 */
export async function touchLaptop(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q: string): MediaQueryList => {
      if (q.replace(/\s/g, '') !== '(any-pointer:coarse)') return real(q);
      const mql = real('all');
      return new Proxy(mql, {
        get(target, key) {
          if (key === 'matches') return true;
          if (key === 'media') return q;
          const v = Reflect.get(target, key, target);
          return typeof v === 'function' ? v.bind(target) : v;
        }
      });
    };
  });
}
