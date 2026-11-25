// The simulation's timeline (timeline-ui rules 5 to 12, 42) for e2e: the playhead slider, waits on the
// forecast's fill through `window.__sfhFzp` (src/lib/fzp/debug.ts), a kind's rows opened, and a
// policy added through the kind's "+". No raised timeouts: each wait is bounded by the test's.
import { expect, type Locator, type Page } from '@playwright/test';
import type { SfhFzpDebug } from '../../src/lib/fzp/debug';
import { PLUS_NAME } from '../../src/lib/timeline/test/plus';

type FzpWin = Window & { __sfhFzp?: SfhFzpDebug };

/** The playhead's slider. */
export const slider = (page: Page): Locator =>
  page.getByRole('slider', { name: 'Date in the simulation' });

/** Waits until the forecast is filled to the window's last month. */
export async function waitFilled(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const f = (window as FzpWin).__sfhFzp;
    return !!f && f.lastIndex >= 0 && f.filledThrough === f.lastIndex && !f.stale;
  });
}

/** Waits until the forecast is filled through calendar-month index `i` (or the window's end). */
export async function waitFilledThrough(page: Page, i: number): Promise<void> {
  await page.waitForFunction((at) => {
    const f = (window as FzpWin).__sfhFzp;
    return !!f && f.lastIndex >= 0 && f.filledThrough >= Math.min(at, f.lastIndex);
  }, i);
}

type HoldWin = Window & { __holdPolicy?: boolean; __releasePolicy?: () => void };

/**
 * Before the page loads: a seam at the worker boundary that, once `holdPolicy` is called, keeps
 * every `setPolicy` from the timeline worker until `releasePolicy`, so the numbers on show stay
 * stale (and "Updating" shows) for as long as the test needs.
 */
export async function installPolicyHold(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as HoldWin;
    const held: [Worker, unknown][] = [];
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, msg: unknown, ...rest: never[]) {
      if (w.__holdPolicy && (msg as { type?: string } | null)?.type === 'setPolicy') {
        held.push([this, msg]);
        return;
      }
      return post.call(this, msg, ...rest);
    } as Worker['postMessage'];
    w.__releasePolicy = () => {
      w.__holdPolicy = false;
      for (const [worker, msg] of held.splice(0)) post.call(worker, msg);
    };
  });
}

/** From now on every `setPolicy` waits (`installPolicyHold` first). */
export async function holdPolicy(page: Page): Promise<void> {
  await page.evaluate(() => ((window as HoldWin).__holdPolicy = true));
}

/** Sends the held `setPolicy` messages, in order, and stops holding. */
export async function releasePolicy(page: Page): Promise<void> {
  await page.evaluate(() => (window as HoldWin).__releasePolicy!());
}

/** A kind's row toggle (its accessible name is the kind's label). */
const kindToggle = (page: Page, kind: string): Locator =>
  page.getByTestId('tl-timeline').getByRole('button', { name: kind, exact: true }).first();

/**
 * Opens a kind's rows: from md in place, below md as a sheet over the timeline. A kind already
 * open stays open.
 */
export async function openKind(
  page: Page,
  kind: 'Zoning' | 'Permitting' | 'Public money'
): Promise<void> {
  const toggle = kindToggle(page, kind);
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

/**
 * Adds a policy from a kind's "+": `choice` is the label the menu offers ("Transit rule",
 * "Painted area", a protection, a permitting preset, "Market terms", ...). The new policy is
 * selected and its editor shows (titled by the policy's label).
 */
export async function addPolicy(page: Page, kind: string, choice: string): Promise<void> {
  const added = await page.evaluate(() => {
    const p = (window as FzpWin).__sfhFzp?.policy;
    return p ? p.kinds.zoning.length + p.kinds.permitting.length + p.kinds.money.length : 0;
  });
  await page
    .getByTestId('tl-timeline')
    // Named "Add {kind} policy", or by the lane's words while a closed empty kind shows them.
    .getByRole('button', { name: PLUS_NAME[kind as keyof typeof PLUS_NAME] })
    // Below md with the kind's sheet open, the sheet's "+" (the grid behind it is inert).
    .last()
    .click();
  const menu = page.getByRole('group', { name: `Add to ${kind}` });
  await menu.getByRole('button', { name: choice, exact: true }).click();
  await page.waitForFunction((n) => {
    const p = (window as FzpWin).__sfhFzp?.policy;
    return !!p && p.kinds.zoning.length + p.kinds.permitting.length + p.kinds.money.length > n;
  }, added);
  await expect(page.getByTestId('inspector')).toBeVisible();
}
