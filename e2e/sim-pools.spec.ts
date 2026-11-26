// The simulation's pool levels (the open game at `/`; timeline-ui, "A pool's bar shows its level"): with A housing bond added, its
// bar in the open Public money kind is full until its money is used and drains after Play, and
// "General revenue, yearly" drains too (a yearly payment never refills it); the bar's name carries
// ", N% left" at the playhead's month. axe on the rows, light and dark.
// fixture-0, the VITE_E2E build's debug hooks, never pixels. Below md the kind is a sheet over an
// inert timeline, so the playhead moves with the sheet closed.
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { SfhFzpDebug } from '../src/lib/fzp/debug';
import { expectNoA11yViolations } from './helpers/a11y';
import { addPolicy, openKind, slider, waitFilled } from './helpers/run';
import type { Win } from './helpers/sharing';

type FzpWin = Win & { __sfhFzp?: SfhFzpDebug };

async function gotoSim(page: Page, colorScheme: 'light' | 'dark' = 'light'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme });
  await page.goto('/');
  await page.waitForFunction(() => (window as FzpWin).__sfhFzp?.phase === 'ready');
  await waitFilled(page);
}

/** A preset measure, as the "+" menu adds it, filled, its editor closed. */
async function addMeasure(page: Page, label: string): Promise<void> {
  await addPolicy(page, 'Public money', label);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('inspector')).toHaveCount(0);
  await waitFilled(page);
}

/** A housing bond. */
const addBond = (page: Page): Promise<void> => addMeasure(page, 'A housing bond');

/** The bond's bar, Public money open. */
async function bondBar(page: Page): Promise<Locator> {
  await openKind(page, 'Public money');
  return page.getByTestId('tl-kind-money').getByTestId('tl-bar').last();
}

/** Below md: the kind's sheet closed, so the playhead can move. */
async function closeSheet(page: Page, isMobile: boolean): Promise<void> {
  if (!isMobile) return;
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Public money' })).toHaveCount(0);
}

test('a housing bond: full until its money is used; after Play its bar drains', async ({
  page,
  isMobile
}) => {
  await gotoSim(page);
  await addBond(page);
  let bar = await bondBar(page);
  // At today: no level, no words.
  await expect(bar.getByTestId('tl-level')).toHaveAttribute('data-left', '');
  await expect(bar).not.toHaveAttribute('aria-label', /left/);
  await closeSheet(page, isMobile);
  // Play past the bond's money: its level shows, and its words say the same number.
  const arrival = await page.evaluate(() => {
    const p = (window as FzpWin).__sfhFzp!.policy.kinds.money[0].spans[0].what;
    return p.tag === 'fund' && p.pool?.inflows[0].kind === 'once' ? p.pool.inflows[0].day : 0;
  });
  expect(arrival).toBeGreaterThan(0);
  await page.getByTestId('tl-speed').click();
  const play = page.getByTestId('tl-play');
  await play.click();
  await page.waitForFunction((a) => (window as FzpWin).__sfhFzp!.day > a + 365, arrival);
  await play.click();
  await expect.poll(() => page.evaluate(() => (window as FzpWin).__sfhFzp!.playing)).toBe(false);
  bar = await bondBar(page);
  const level = bar.getByTestId('tl-level');
  await expect(level).toHaveAttribute('data-left', /^\d+$/);
  let left = await level.getAttribute('data-left');
  // The name starts with the words on the bar (WCAG 2.5.3).
  await expect(bar).toHaveAttribute('aria-label', new RegExp(`^\\S+, ${left}% left, `));
  await expect(bar).toHaveText(new RegExp(`, ${left}% left$`));
  // At the computed edge (End) the bond has been drawn on: below 100, and a once pool only drains,
  // so at most the paused reading. Read only once the slider's DOM says it is at the edge.
  const paused = Number(left);
  await closeSheet(page, isMobile);
  const ruler = slider(page);
  const edge = await ruler.getAttribute('aria-valuemax');
  expect(Number(edge)).toBeGreaterThan(Number(await ruler.getAttribute('aria-valuenow')));
  await ruler.focus();
  await page.keyboard.press('End');
  await expect(ruler).toHaveAttribute('aria-valuenow', edge!);
  bar = await bondBar(page);
  await expect(level).toHaveAttribute('data-left', /^\d+$/);
  left = await level.getAttribute('data-left');
  expect(Number(left)).toBeLessThan(100);
  expect(Number(left)).toBeLessThanOrEqual(paused);
  // The name starts with the words on the bar (WCAG 2.5.3).
  await expect(bar).toHaveAttribute('aria-label', new RegExp(`^\\S+, ${left}% left, `));
  await expect(bar).toHaveText(new RegExp(`, ${left}% left$`));
  // Home: at today, nothing again.
  await closeSheet(page, isMobile);
  await slider(page).focus();
  await page.keyboard.press('Home');
  await expect
    .poll(() => page.evaluate(() => (window as FzpWin).__sfhFzp!.day))
    .toBe(await page.evaluate(() => (window as FzpWin).__sfhFzp!.asOf));
  bar = await bondBar(page);
  await expect(bar.getByTestId('tl-level')).toHaveAttribute('data-left', '');
  await expect(bar).not.toHaveAttribute('aria-label', /left/);
});

test('general revenue, yearly: after Play its bar has drawn down', async ({ page, isMobile }) => {
  await gotoSim(page);
  await addMeasure(page, 'General revenue, yearly');
  await bondBar(page);
  await closeSheet(page, isMobile);
  const first = await page.evaluate(() => {
    const p = (window as FzpWin).__sfhFzp!.policy.kinds.money[0].spans[0].what;
    return p.tag === 'fund' && p.pool?.inflows[0].kind === 'yearly' ? p.pool.inflows[0].from : 0;
  });
  expect(first).toBeGreaterThan(0);
  await page.getByTestId('tl-speed').click();
  const play = page.getByTestId('tl-play');
  await play.click();
  await page.waitForFunction((a) => (window as FzpWin).__sfhFzp!.day > a + 365, first);
  await play.click();
  await expect.poll(() => page.evaluate(() => (window as FzpWin).__sfhFzp!.playing)).toBe(false);
  const ruler = slider(page);
  const edge = await ruler.getAttribute('aria-valuemax');
  await ruler.focus();
  await page.keyboard.press('End');
  await expect(ruler).toHaveAttribute('aria-valuenow', edge!);
  const bar = await bondBar(page);
  const level = bar.getByTestId('tl-level');
  await expect(level).toHaveAttribute('data-left', /^\d+$/);
  const left = await level.getAttribute('data-left');
  expect(Number(left)).toBeLessThan(100);
  // The name starts with the words on the bar (WCAG 2.5.3): the setting, then the level.
  await expect(bar).toHaveAttribute('aria-label', new RegExp(`^[^,]+, ${left}% left, `));
});

test("forced colours: the bond's level is drawn in a system colour", async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await gotoSim(page);
  await addBond(page);
  await slider(page).focus();
  await page.keyboard.press('End');
  const bar = await bondBar(page);
  const level = bar.getByTestId('tl-level');
  await expect(level).toHaveAttribute('data-left', /^\d+$/);
  const drawn = await level.evaluate((svg) => {
    const probe = document.body.appendChild(document.createElement('span'));
    const sys = (c: string) => {
      probe.style.color = c;
      return getComputedStyle(probe).color;
    };
    const want = { gray: sys('GrayText'), text: sys('ButtonText'), canvas: sys('Canvas') };
    probe.remove();
    const paths = [...svg.querySelectorAll('path')];
    return {
      want,
      adjust: getComputedStyle(svg).getPropertyValue('forced-color-adjust'),
      fills: paths
        .filter((p) => p.getAttribute('fill') !== 'none')
        .map((p) => getComputedStyle(p).fill),
      strokes: paths
        .filter((p) => p.getAttribute('fill') === 'none')
        .map((p) => getComputedStyle(p).stroke)
    };
  });
  expect(drawn.adjust).toBe('none');
  // The empty part in GrayText, its edge in ButtonText: both differ from the bar's ground.
  expect(drawn.fills).toEqual([drawn.want.gray, drawn.want.gray]);
  expect(drawn.strokes).toEqual([drawn.want.text, drawn.want.text]);
  expect(drawn.want.gray).not.toBe(drawn.want.canvas);
});

test("forced colours: each bar's extent is drawn as a 1 px ButtonText line; none otherwise", async ({
  page
}) => {
  await gotoSim(page);
  await addBond(page);
  await bondBar(page);
  /** Every bar in the open Public money kind (below md, its sheet) not selected or focused. */
  const outlines = () =>
    page
      .getByTestId('tl-kind-money')
      .last()
      .evaluate((kind) => {
        const probe = document.body.appendChild(document.createElement('span'));
        probe.style.color = 'ButtonText';
        const text = getComputedStyle(probe).color;
        probe.remove();
        const bars = [...kind.querySelectorAll<HTMLElement>('button.bar')].filter(
          (b) => !b.matches('.sel, :focus-visible')
        );
        return {
          text,
          bars: bars.map((b) => {
            const s = getComputedStyle(b);
            return [s.outlineStyle, s.outlineWidth, s.outlineColor, s.outlineOffset];
          })
        };
      });
  // The span bar and the fixed "Current funding" bar at least.
  const plain = await outlines();
  expect(plain.bars.length).toBeGreaterThanOrEqual(2);
  for (const b of plain.bars) expect(b[0]).toBe('none');
  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
  await expect
    .poll(() => page.evaluate(() => matchMedia('(forced-colors: active)').matches))
    .toBe(true);
  const forced = await outlines();
  expect(forced.bars).toHaveLength(plain.bars.length);
  for (const b of forced.bars) expect(b).toEqual(['solid', '1px', forced.text, '-1px']);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the Public money rows with levels: axe clean, ${scheme}`, async ({ page }) => {
    await gotoSim(page, scheme);
    await addBond(page);
    await slider(page).focus();
    await page.keyboard.press('End');
    const bar = await bondBar(page);
    await expect(bar.getByTestId('tl-level')).toHaveAttribute('data-left', /^\d+$/);
    await expectNoA11yViolations(page, { include: ['[data-testid=tl-timeline]'] });
  });
}
