// Target size (WCAG 2.2 AA, 2.5.8; docs/dev/accessibility.md): at 375 px on the mobile project
// (touch, coarse pointer), every visible interactive element on `/`, `/sim` and `/lesscars` is at
// least 24 by 24 CSS px, at rest and with the page's sheets, menus and panels open. One size for
// every pointer: nothing here needs 44 px. The exemptions are listed below with their reasons.
import { expect, test, type Page } from '@playwright/test';
import { addPolicy, waitFilled } from './helpers/run';
import { gotoEditor, openHeaderMenu } from './helpers/sharing';

type W = Window & { __sfhFzp?: { phase?: string }; __sfhLessCars?: { phase?: string } };

/** What counts as a target. */
const INTERACTIVE = [
  'a[href]',
  'button',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  'summary',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="radio"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="menuitem"]',
  '[role="slider"]',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

/**
 * Exempt, with the reason (2.5.8's exceptions):
 * - Inline: a link inside a sentence or a list of sources (the map attribution's links, a citation
 *   in Details), sized by the line it sits in.
 * - Equivalent: MapLibre's canvas and its own attribution parts (the map is panned by touch; the
 *   "i" control and the canvas are MapLibre's, and the page's own controls do what they do).
 */
const EXEMPT: { selector: string; reason: string }[] = [
  { selector: '.maplibregl-ctrl-attrib-inner a', reason: 'inline: attribution links in a line' },
  { selector: '.maplibregl-canvas', reason: 'equivalent: the map itself, panned by touch' },
  { selector: 'p a, li a, dd a, td a', reason: 'inline: a link in a sentence or a list' }
];

/**
 * Every visible target smaller than 24 px either way that also fails 2.5.8's spacing exception (a
 * 24 px circle on its centre meets another target or another small target's circle), as
 * "tag name w x h".
 */
async function small(page: Page): Promise<{ crowded: string[]; spaced: string[] }> {
  return page.evaluate(
    ({ sel, exempt }) => {
      type T = { label: string; r: DOMRect };
      const targets: T[] = [];
      const seen = new Set<Element>();
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: false })) continue;
        if (el.closest('[inert]')) continue;
        if (exempt.some((s) => el.matches(s))) continue;
        let target: HTMLElement = el;
        // A radio or a checkbox is pressed through its label too: measure the label.
        if (
          el instanceof HTMLInputElement &&
          (el.type === 'radio' || el.type === 'checkbox') &&
          el.labels?.[0]
        )
          target = el.labels[0];
        const r0 = target.getBoundingClientRect();
        // Anything else this small is visually hidden until focused (the skip link): not a
        // target yet.
        if (r0.width <= 1 && r0.height <= 1) continue;
        // A button whose ::before is stretched over its box (the header score) is pressed
        // anywhere in that box: measure the box.
        const before = getComputedStyle(el, '::before');
        if (before.position === 'absolute' && before.content !== 'none' && el.offsetParent)
          target = el.offsetParent as HTMLElement;
        if (seen.has(target)) continue;
        seen.add(target);
        const r = target.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const name =
          el.getAttribute('aria-label') ||
          el.getAttribute('data-testid') ||
          (el.textContent ?? '').trim().slice(0, 30) ||
          el.tagName;
        targets.push({ label: `${el.tagName.toLowerCase()} "${name}"`, r });
      }
      const isSmall = (r: DOMRect) => r.width < 23.5 || r.height < 23.5;
      const centre = (r: DOMRect) => [r.x + r.width / 2, r.y + r.height / 2] as const;
      /** Distance from a point to a rectangle (0 inside it). */
      const toRect = (x: number, y: number, r: DOMRect) =>
        Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
      const crowded: string[] = [];
      const spaced: string[] = [];
      for (const t of targets) {
        if (!isSmall(t.r)) continue;
        const [x, y] = centre(t.r);
        const near = targets.some((o) => {
          if (o === t) return false;
          // Nested in each other (a label around its input): one target, not two.
          if (
            o.r.left <= t.r.left &&
            o.r.right >= t.r.right &&
            o.r.top <= t.r.top &&
            o.r.bottom >= t.r.bottom
          )
            return false;
          if (isSmall(o.r)) {
            const [ox, oy] = centre(o.r);
            return Math.hypot(x - ox, y - oy) < 24;
          }
          return toRect(x, y, o.r) < 12;
        });
        (near ? crowded : spaced).push(
          `${t.label} ${t.r.width.toFixed(1)}x${t.r.height.toFixed(1)}`
        );
      }
      return { crowded, spaced };
    },
    { sel: INTERACTIVE, exempt: EXEMPT.map((e) => e.selector) }
  );
}

/**
 * Fails on any target under 24 px that its neighbours crowd; notes the ones under 24 px that pass
 * on 2.5.8's spacing exception, so the report can list them.
 */
async function expectTargets(page: Page, where: string): Promise<void> {
  const { crowded, spaced } = await small(page);
  for (const s of spaced)
    test.info().annotations.push({ type: 'spaced', description: `${where}: ${s}` });
  expect(crowded, where).toEqual([]);
}

test.describe('targets at 375 px', () => {
  // eslint-disable-next-line playwright/no-skipped-test -- the sweep is the phone's (375 px)
  test.skip(({ isMobile }) => !isMobile, 'the phone sweep');

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('/: at rest, the Menu, the Paint sheet, the palette strip', async ({ page }) => {
    await gotoEditor(page);
    await expectTargets(page, '/ at rest');
    await openHeaderMenu(page);
    await expectTargets(page, '/ Menu open');
    await page.keyboard.press('Escape');
    const handle = page.getByTestId('dock-handle');
    await handle.click();
    await expect(handle).toHaveAttribute('aria-expanded', 'true');
    await expectTargets(page, '/ Paint sheet');
    await page.getByRole('radio', { name: 'Paint', exact: true }).click();
    await expect(page.getByTestId('palette-strip')).toBeVisible();
    await expectTargets(page, '/ palette strip');
  });

  test('/sim: at rest, the key, a policy editor, Details', async ({ page }) => {
    await page.goto('/sim');
    await page.waitForFunction(() => (window as W).__sfhFzp?.phase === 'ready');
    await expect(page.getByTestId('map-root')).toHaveAttribute('data-state', 'ready', {
      timeout: 20_000
    });
    await waitFilled(page);
    await expectTargets(page, '/sim at rest');
    const key = page.getByTestId('map-key-toggle');
    await key.click();
    await expect(page.getByRole('group', { name: 'Map key' })).toBeVisible();
    await expectTargets(page, '/sim key open');
    await key.click();
    await addPolicy(page, 'Zoning', 'Transit rule');
    await expect(page.getByTestId('inspector')).toBeVisible();
    await expectTargets(page, '/sim policy editor');
    await page.getByTestId('score-bar').click();
    await expect(page.getByTestId('tl-details')).toBeVisible();
    await expectTargets(page, '/sim Details');
  });

  test('/lesscars at rest', async ({ page }) => {
    await page.goto('/lesscars');
    await page.waitForFunction(() => (window as W).__sfhLessCars?.phase === 'ready', undefined, {
      timeout: 20_000
    });
    await expect(page.getByTestId('map-root')).toHaveAttribute('data-state', 'ready', {
      timeout: 20_000
    });
    await expectTargets(page, '/lesscars at rest');
  });
});
