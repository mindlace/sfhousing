// Target size (WCAG 2.2 AA, 2.5.8; docs/dev/accessibility.md): at 375 px on the mobile project
// (touch, coarse pointer), every visible interactive element on `/`, `/sim`, `/lesscars` and
// `/about` is at least 24 by 24 CSS px, at rest and with the page's sheets, menus, panels and
// dialogs open (About over `/sim`, the assumptions open on `/about`). One size for
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
 * - Inline: a link in a sentence, sized by the line it sits in: the map credit's two links, and
 *   any link whose parent holds text of its own beside it (`inlineLink` below). A link that is its
 *   list item's or paragraph's whole content (a step in the Menu, a source in a list) is a
 *   standalone target and is measured.
 * - Equivalent: MapLibre's canvas (the map is panned by touch; the page's own controls do what it
 *   does).
 */
const EXEMPT: { selector: string; reason: string }[] = [
  { selector: '.maplibregl-ctrl-attrib-inner a', reason: 'inline: attribution links in a line' },
  { selector: '.maplibregl-canvas', reason: 'equivalent: the map itself, panned by touch' }
];

/**
 * What may cover a target at its centre without a defect: an open sheet, dialog, popover or
 * toolbar panel that does not hold the target (a cover inside the target's own column or panel is a
 * defect). Each such cover is annotated. The map's credit is none of these: open or collapsed it
 * covers no control, except Paint's phone strip when the person opens it there (by design: it
 * draws above the strip until closed), a state no sweep here takes.
 */
const OVERLAY = [
  'dialog[open]',
  '[role="dialog"]',
  ':popover-open',
  '[data-testid="map-key-panel"]:not([hidden])',
  '[data-testid="map-layers-panel"]:not([hidden])',
  '[data-testid="tl-inspector"]',
  // `/`'s dock sheet, while its handle has it open.
  '.sfh-dock:has([data-testid="dock-handle"][aria-expanded="true"]) .sfh-dock-sheet'
].join(',');

/**
 * Every visible target smaller than 24 px either way that also fails 2.5.8's spacing exception (a
 * 24 px circle on its centre meets another target or another small target's circle), as
 * "tag name w x h" (a crowded one also names the neighbour it meets), and every target covered at
 * its centre by something not in `OVERLAY` and not itself a target ("covered by …"). Targets an
 * overlay covers are left out and listed in `skipped`.
 */
async function small(
  page: Page
): Promise<{ crowded: string[]; spaced: string[]; skipped: string[]; measured: number }> {
  return page.evaluate(
    ({ sel, exempt, overlay }) => {
      type T = { label: string; r: DOMRect };
      const targets: T[] = [];
      const skipped: string[] = [];
      const covered: string[] = [];
      const seen = new Set<Element>();
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: false })) continue;
        if (el.closest('[inert]')) continue;
        if (exempt.some((s) => el.matches(s))) continue;
        // Inline: a link with text of its parent's own beside it, in the same line of prose.
        const inlineLink =
          el instanceof HTMLAnchorElement &&
          [...(el.parentElement?.childNodes ?? [])].some(
            (n) => n !== el && n.nodeType === Node.TEXT_NODE && !!n.textContent?.trim()
          );
        if (inlineLink) continue;
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
        const label = `${el.tagName.toLowerCase()} "${name}"`;
        // Covered at its centre by something else. By an open sheet, dialog or popover (a timeline
        // bar under the phone's open editor), or by a target that holds it or that it holds: not
        // pressable there, so not a target in this state, and noted. By anything else (a layer or
        // a separate control over a control): a defect. Off-screen points read null: kept.
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        // Scrolled out of a box that clips it (a panel's row below its fold) while its centre is
        // on screen: not pressable until scrolled to, so noted; the test scrolls it into view and
        // sweeps again. Off-screen centres (hit null) are kept, as below.
        // Only a real scroller (overflow auto or scroll, with more content than room) in the
        // target's containing-block chain clips it: the walk stops at a fixed element or the top
        // layer (a popover or dialog), and passes over static ancestors between an absolutely
        // placed element and its containing block.
        const clipper = (() => {
          if (!hit) return null;
          const [cx, cy] = [r.x + r.width / 2, r.y + r.height / 2];
          const pos = getComputedStyle(target).position;
          if (pos === 'fixed' || target.matches(':popover-open, dialog[open]')) return null;
          let skip = pos === 'absolute';
          for (let a = target.parentElement; a && a !== document.body; a = a.parentElement) {
            const s = getComputedStyle(a);
            const scroller =
              /auto|scroll/.test(s.overflowX + s.overflowY) &&
              (a.scrollHeight > a.clientHeight || a.scrollWidth > a.clientWidth);
            if (scroller && (!skip || s.position !== 'static')) {
              const b = a.getBoundingClientRect();
              if (cx < b.left || cx > b.right || cy < b.top || cy > b.bottom) return a;
            }
            if (s.position === 'fixed' || a.matches(':popover-open, dialog[open]')) return null;
            if (s.position === 'absolute') skip = true;
            else if (s.position !== 'static') skip = false;
          }
          return null;
        })();
        if (clipper) {
          const where = clipper.getAttribute('data-testid') || clipper.tagName.toLowerCase();
          skipped.push(`${label} scrolled out of ${where}`);
          continue;
        }
        if (hit && !target.contains(hit) && !hit.contains(target)) {
          const by =
            hit.getAttribute('data-testid') ||
            hit.getAttribute('aria-label') ||
            hit.tagName.toLowerCase();
          // An overlay covers what lies under it, not its own controls: a cover inside the same
          // column, sheet or panel as the target is a defect.
          const o = hit.closest(overlay);
          // A target over a target is one press only when one holds the other (a button inside
          // the target that covers it); two separate controls on top of each other are a defect.
          const t = hit.closest(sel);
          const nested = !!t && (t.contains(target) || target.contains(t));
          if ((o && !o.contains(target)) || nested) skipped.push(`${label} by ${by}`);
          else covered.push(`${label} covered by ${by}`);
          continue;
        }
        targets.push({ label, r });
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
        const near = targets.find((o) => {
          if (o === t) return false;
          // Nested in each other (a label around its input): one target, not two.
          if (
            o.r.left <= t.r.left &&
            o.r.right >= t.r.right &&
            o.r.top <= t.r.top &&
            o.r.bottom >= t.r.bottom
          )
            return false;
          // Another small target: its circle, and its box too (a small target can be long and
          // thin, reaching far past its own circle).
          if (isSmall(o.r)) {
            const [ox, oy] = centre(o.r);
            return Math.hypot(x - ox, y - oy) < 24 || toRect(x, y, o.r) < 12;
          }
          return toRect(x, y, o.r) < 12;
        });
        const size = `${t.label} ${t.r.width.toFixed(1)}x${t.r.height.toFixed(1)}`;
        if (near) crowded.push(`${size}, beside ${near.label}`);
        else spaced.push(size);
      }
      return { crowded: [...covered, ...crowded], spaced, skipped, measured: targets.length };
    },
    { sel: INTERACTIVE, exempt: EXEMPT.map((e) => e.selector), overlay: OVERLAY }
  );
}

/**
 * Fails on any target under 24 px that its neighbours crowd; notes the ones under 24 px that pass
 * on 2.5.8's spacing exception, so the report can list them. Also fails when it measured fewer
 * than `floor` targets (a sweep that sees nothing passes on nothing), and returns the count.
 */
// Each state's floor sits a third or so under what it measured on fixture-0 (Task 2b review M3):
// low enough to survive a control added or dropped, high enough that a sweep seeing half the page
// fails.
async function expectTargets(page: Page, where: string, floor: number): Promise<number> {
  const { crowded, spaced, skipped, measured } = await small(page);
  for (const s of skipped)
    test.info().annotations.push({ type: 'covered', description: `${where}: ${s}` });
  for (const s of spaced)
    test.info().annotations.push({ type: 'spaced', description: `${where}: ${s}` });
  test.info().annotations.push({ type: 'measured', description: `${where}: ${measured}` });
  expect(crowded, where).toEqual([]);
  expect(measured, `${where}: targets measured`).toBeGreaterThanOrEqual(floor);
  return measured;
}

/** Opens the map's credit from its (i) (the e2e build starts it collapsed); focus stays on it. */
async function openCredit(page: Page): Promise<void> {
  const toggle = page.getByTestId('map-root').getByLabel('Map credits');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

/** /sim with its map ready and the forecast filled. */
async function gotoSimReady(page: Page): Promise<void> {
  await page.goto('/sim');
  await page.waitForFunction(() => (window as W).__sfhFzp?.phase === 'ready');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="map-root"]')?.getAttribute('data-state') === 'ready'
  );
  await waitFilled(page);
}

test.describe('targets at 375 px', () => {
  // eslint-disable-next-line playwright/no-skipped-test -- the sweep is the phone's (375 px)
  test.skip(({ isMobile }) => !isMobile, 'the phone sweep');

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('/: at rest, the Menu, the Paint sheet, the palette strip', async ({ page }) => {
    await gotoEditor(page);
    const rest = await expectTargets(page, '/ at rest', 5);
    await openCredit(page);
    await expectTargets(page, '/ credit open', 5);
    await page.keyboard.press('Escape');
    await openHeaderMenu(page);
    // The Menu adds the site name, the two steps, Publish, Sign in and About.
    expect(await expectTargets(page, '/ Menu open', 10)).toBeGreaterThan(rest);
    await page.keyboard.press('Escape');
    const handle = page.getByTestId('dock-handle');
    await handle.click();
    await expect(handle).toHaveAttribute('aria-expanded', 'true');
    await expectTargets(page, '/ Paint sheet', 15);
    await page.getByRole('radio', { name: 'Paint', exact: true }).click();
    await expect(page.getByTestId('palette-strip')).toBeVisible();
    await expectTargets(page, '/ palette strip', 8);
  });

  test('/: the palette strip at 320 px, Undo, Redo and Done as its check', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 812 });
    await gotoEditor(page);
    const handle = page.getByTestId('dock-handle');
    await handle.click();
    await page.getByRole('radio', { name: 'Paint', exact: true }).click();
    const strip = page.getByTestId('palette-strip');
    await expect(strip).toBeVisible();
    await expect(strip.getByRole('button', { name: 'Redo', exact: true })).toBeVisible();
    await expect(strip.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
    await expectTargets(page, '/ palette strip at 320', 8);
  });

  test('/sim: the timeline rows with a policy per kind, names on their own lines, and a kind sheet', async ({
    page
  }) => {
    await gotoSimReady(page);
    const close = async () => {
      await page.getByTestId('inspector').getByRole('button', { name: 'Close editor' }).click();
      await expect(page.getByTestId('inspector')).toHaveCount(0);
      // Below md the editor's kind sheet stays open: close it for the next kind.
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    };
    await addPolicy(page, 'Zoning', 'Transit rule');
    await close();
    await addPolicy(page, 'Permitting', "Permits at San Diego's pace");
    await close();
    await addPolicy(page, 'Public money', 'A housing bond');
    await close();
    const world = page.getByTestId('tl-world');
    await world.scrollIntoViewIfNeeded();
    await expect(
      page.getByTestId('tl-kind-zoning').getByRole('button', { name: 'Zoning', exact: true })
    ).toBeInViewport();
    await expectTargets(page, '/sim timeline rows', 10);
    await page
      .getByTestId('tl-rows')
      .getByRole('button', { name: 'Public money', exact: true })
      .click();
    await expect(page.getByRole('dialog', { name: 'Public money' })).toBeVisible();
    await expectTargets(page, '/sim Public money sheet', 4);
  });

  test('/sim: at rest, the Menu, the key, the Layers panel, a Zoning editor, Details', async ({
    page
  }) => {
    await gotoSimReady(page);
    const rest = await expectTargets(page, '/sim at rest', 15);
    await openCredit(page);
    await expectTargets(page, '/sim credit open', 15);
    await page.keyboard.press('Escape');
    await openHeaderMenu(page);
    // The Menu adds the site name, the steps, Undo, Redo, Publish, Sign in and About.
    expect(await expectTargets(page, '/sim Menu open', 20)).toBeGreaterThan(rest);
    await page.keyboard.press('Escape');
    const key = page.getByTestId('map-key-toggle');
    await key.click();
    await expect(page.getByRole('group', { name: 'Map key' })).toBeVisible();
    await expectTargets(page, '/sim key open', 15);
    await key.click();
    const layers = page.getByRole('button', { name: 'Map layers' });
    await layers.click();
    const layersPanel = page.getByRole('group', { name: 'Map layers' });
    await expect(layersPanel).toBeVisible();
    await expectTargets(page, '/sim Layers panel', 15);
    // The panel scrolls inside the room above its toolbar: its last row, scrolled to, is
    // measured too, clear of the attribution under the toolbar.
    const last = layersPanel.getByRole('checkbox').last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await expectTargets(page, '/sim Layers panel scrolled', 15);
    expect(
      await last.evaluate((el) => {
        const r = (el as HTMLInputElement).labels![0].getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return !!hit && (el as HTMLInputElement).labels![0].contains(hit);
      }),
      'the last layer row is pressable at its centre'
    ).toBe(true);
    await layers.click();
    await addPolicy(page, 'Zoning', 'Transit rule');
    await expect(page.getByTestId('inspector')).toBeVisible();
    await expectTargets(page, '/sim Zoning editor', 25);
    await page.getByTestId('score-bar').click();
    await expect(page.getByTestId('tl-details')).toBeVisible();
    await expectTargets(page, '/sim Details', 10);
  });

  test('a fixed target under a short scroller is measured, never noted as scrolled out of it', async ({
    page
  }) => {
    await gotoEditor(page);
    // A short scroller at the top, and inside it two 16 px buttons fixed to the viewport well
    // below its box: overflow never clips them, so the sweep measures them (and finds them
    // crowding each other) rather than skipping them.
    await page.evaluate(() => {
      const box = document.createElement('div');
      box.style.cssText =
        'position:fixed;left:0;top:60px;width:100px;height:40px;overflow:auto;z-index:9998';
      box.innerHTML =
        '<div style="height:200px"></div>' +
        '<button aria-label="fixed-a" style="position:fixed;left:150px;top:300px;width:16px;height:16px;z-index:9999"></button>' +
        '<button aria-label="fixed-b" style="position:fixed;left:170px;top:300px;width:16px;height:16px;z-index:9999"></button>';
      document.body.appendChild(box);
    });
    const { crowded, skipped } = await small(page);
    expect(skipped.filter((s) => s.includes('fixed-'))).toEqual([]);
    expect(crowded.some((c) => c.startsWith('button "fixed-a" 16.0x16.0'))).toBe(true);
  });

  test('a top-layer target and an absolute target past a static scroller are measured, never scrolled out', async ({
    page
  }) => {
    await gotoEditor(page);
    await page.evaluate(() => {
      // 1. A popover (the top layer) inside a short fixed scroller, placed absolutely by the author
      //    so only the walk's top-layer stop keeps the scroller from counting.
      const box = document.createElement('div');
      box.style.cssText =
        'position:fixed;left:0;top:60px;width:100px;height:40px;overflow:auto;z-index:9998';
      box.innerHTML =
        '<div style="height:200px"></div>' +
        '<div popover="manual" style="position:absolute;inset:auto;left:150px;top:300px;margin:0;padding:0;border:0;width:60px;height:16px">' +
        '<button aria-label="pop-a" style="position:absolute;left:0;top:0;width:16px;height:16px"></button>' +
        '<button aria-label="pop-b" style="position:absolute;left:20px;top:0;width:16px;height:16px"></button>' +
        '</div>';
      document.body.appendChild(box);
      box.querySelector<HTMLElement>('[popover]')!.showPopover();
      // 2. Two buttons placed absolutely against a relative box, inside a short static scroller
      //    between them and it: the scroller is not their containing block, so it never clips them.
      const fixed = document.createElement('div');
      fixed.style.cssText = 'position:fixed;left:0;top:420px;width:400px;height:200px;z-index:9999';
      fixed.innerHTML =
        '<div style="position:relative;width:400px;height:200px">' +
        '<div style="height:40px;width:100px;overflow:auto">' +
        '<div style="height:200px"></div>' +
        '<button aria-label="abs-a" style="position:absolute;left:150px;top:120px;width:16px;height:16px"></button>' +
        '<button aria-label="abs-b" style="position:absolute;left:170px;top:120px;width:16px;height:16px"></button>' +
        '</div></div>';
      document.body.appendChild(fixed);
    });
    const { crowded, skipped } = await small(page);
    expect(skipped.filter((s) => /pop-|abs-/.test(s))).toEqual([]);
    expect(crowded.some((c) => c.startsWith('button "pop-a" 16.0x16.0'))).toBe(true);
    expect(crowded.some((c) => c.startsWith('button "abs-a" 16.0x16.0'))).toBe(true);
  });

  test('a control over a separate control fails the sweep; over a control it holds, it does not', async ({
    page
  }) => {
    await gotoEditor(page);
    await page.evaluate(() => {
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:0;top:300px;width:300px;height:200px;z-index:9999';
      box.innerHTML =
        // Two separate buttons, the second laid over the first.
        '<button aria-label="under" style="position:absolute;left:10px;top:10px;width:40px;height:40px"></button>' +
        '<button aria-label="over" style="position:absolute;left:10px;top:10px;width:40px;height:40px"></button>' +
        // A button inside a role=button, whose own child covers it: one press, not two.
        '<div role="button" tabindex="0" aria-label="outer" style="position:absolute;left:100px;top:10px;width:120px;height:60px">' +
        '<button aria-label="inner" style="position:absolute;left:10px;top:10px;width:40px;height:40px"></button>' +
        '<span style="position:absolute;left:10px;top:10px;width:40px;height:40px"></span>' +
        '</div>';
      document.body.appendChild(box);
    });
    const { crowded, skipped } = await small(page);
    expect(crowded).toContain('button "under" covered by over');
    expect(crowded.filter((c) => c.includes('"inner"'))).toEqual([]);
    expect(skipped).toContain('button "inner" by span');
  });

  test('/sim: a layer inside the detail column over its own control fails the sweep', async ({
    page
  }) => {
    await gotoSimReady(page);
    await addPolicy(page, 'Zoning', 'Transit rule');
    const column = page.getByTestId('tl-inspector');
    await expect(column).toBeVisible();
    // A plain box inside the column, laid over the column's first visible button.
    const name = await column.evaluate((col: HTMLElement) => {
      const b = [...col.querySelectorAll('button')].find((e) => e.checkVisibility())!;
      const r = b.getBoundingClientRect();
      const d = document.createElement('div');
      d.style.cssText = `position:fixed;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;z-index:9999`;
      col.appendChild(d);
      return b.getAttribute('aria-label') || b.getAttribute('data-testid') || b.textContent!.trim();
    });
    const { crowded } = await small(page);
    expect(crowded.some((c) => c.includes(name.slice(0, 30)) && c.endsWith('covered by div'))).toBe(
      true
    );
  });

  // One editor per page: below md an editor opens in its kind's sheet, over the other kinds.
  for (const [kind, choice] of [
    ['Permitting', "Permits at San Diego's pace"],
    ['Public money', 'A housing bond']
  ])
    test(`/sim: the ${kind} editor`, async ({ page }) => {
      await gotoSimReady(page);
      await addPolicy(page, kind, choice);
      await expectTargets(page, `/sim ${kind} editor`, 25);
    });

  test('/about: at rest and with the assumptions open', async ({ page }) => {
    await page.goto('/about');
    await expect(page.locator('html')).toHaveAttribute('data-hydrated', '');
    await expectTargets(page, '/about at rest', 20);
    const show = page.locator('#about-assumptions').getByText('Show the assumptions', {
      exact: true
    });
    await show.click();
    await expect(
      page.locator('#src-quality').getByRole('table', { name: 'Data checks that changed a value' })
    ).toBeVisible();
    await expectTargets(page, '/about assumptions open', 40);
  });

  test('/sim: About open from the Menu', async ({ page }) => {
    await gotoSimReady(page);
    await openHeaderMenu(page);
    await page.getByRole('link', { name: 'About', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'About this model' });
    await expect(dialog).toBeVisible();
    // The data checks have loaded: the whole body is there.
    await expect(dialog.locator('[id="src-quality"] tbody tr').first()).toBeVisible();
    await expectTargets(page, '/sim About open', 20);
  });

  test('/lesscars at rest', async ({ page }) => {
    await page.goto('/lesscars');
    await page.waitForFunction(() => (window as W).__sfhLessCars?.phase === 'ready');
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="map-root"]')?.getAttribute('data-state') === 'ready'
    );
    await expect(page.getByTestId('map-root')).toHaveAttribute('data-state', 'ready');
    await expectTargets(page, '/lesscars at rest', 8);
  });
});
