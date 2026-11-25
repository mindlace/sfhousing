import { createRawSnippet, mount, unmount } from 'svelte';
import SaveIndicator from '$lib/sharing/SaveIndicator.svelte';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { focusHeaderMenu } from './header-actions.svelte';
import SiteHeader from './SiteHeader.svelte';
import HeaderScoreHeader from './test/HeaderScoreHeader.svelte';
import { quietSync, seededGame } from './test/seeded-game';
import GameHeaderHost from './test/GameHeaderHost.svelte';
import GoalPinnedHeader from './test/GoalPinnedHeader.svelte';
import SimRowGameHeader from './test/SimRowGameHeader.svelte';
import SimRowHeader from './test/SimRowHeader.svelte';

const WON = '2026-11-22T12:00:00.000Z';

describe('SiteHeader', () => {
  it('renders a banner with a home link', async () => {
    render(SiteHeader);
    const banner = page.getByRole('banner');
    await expect.element(banner).toBeVisible();
    const link = banner.getByRole('link', { name: 'SF Housing', exact: true });
    await expect.element(link).toHaveAttribute('href', '/');
  });

  it('renders the actions snippet inside the header', async () => {
    await page.viewport(1024, 768);
    const actions = createRawSnippet(() => ({ render: () => '<button>Publish</button>' }));
    render(SiteHeader, { actions });
    await expect
      .element(page.getByRole('banner').getByRole('button', { name: 'Publish' }))
      .toBeVisible();
  });

  it('is 48px tall', async () => {
    render(SiteHeader);
    const el = page.getByRole('banner').element();
    expect(el.getBoundingClientRect().height).toBe(48);
  });

  describe('account entry', () => {
    it('links a signed-out visitor to /signin', async () => {
      await page.viewport(1024, 768);
      render(SiteHeader, { user: null });
      const link = page.getByRole('banner').getByRole('link', { name: 'Sign in' });
      await expect.element(link).toHaveAttribute('href', '/signin');
    });

    it('offers no Sign in when no sign-in method is in effect', async () => {
      await page.viewport(1024, 768);
      render(SiteHeader, { user: null, signInAvailable: false });
      await expect.element(page.getByRole('banner')).toBeVisible();
      expect(page.getByRole('link', { name: 'Sign in' }).elements()).toHaveLength(0);
      expect(document.querySelector('[data-header-account]')).toBeNull();
    });

    it('still links a signed-in user to /account when no sign-in method is in effect', async () => {
      await page.viewport(1024, 768);
      render(SiteHeader, { user: { handle: 'ada' }, signInAvailable: false });
      const link = page.getByRole('banner').getByRole('link', { name: '@ada' });
      await expect.element(link).toHaveAttribute('href', '/account');
    });

    it('links a signed-in user to /account, by handle', async () => {
      await page.viewport(1024, 768);
      render(SiteHeader, { user: { handle: 'ada' } });
      const link = page.getByRole('banner').getByRole('link', { name: '@ada' });
      await expect.element(link).toHaveAttribute('href', '/account');
    });

    it('carries the full handle as a title, since a long one is truncated', async () => {
      await page.viewport(1024, 768);
      const handle = 'a-very-long-handle-that-will-not-fit-in-the-header';
      render(SiteHeader, { user: { handle } });
      const link = page.getByRole('banner').getByRole('link', { name: `@${handle}` });
      await expect.element(link).toHaveAttribute('title', `@${handle}`);
    });

    it('at 375px waits in the Menu until it opens, then sits in the panel', async () => {
      await page.viewport(375, 812);
      render(SiteHeader, { user: null });
      await expect.element(page.getByText('Sign in')).not.toBeVisible();
      await page.getByRole('button', { name: 'Menu' }).click();
      const link = page.getByRole('link', { name: 'Sign in' });
      await expect.element(link).toBeVisible();
      const menu = page.getByRole('button', { name: 'Menu' }).element();
      const panel = document.getElementById(menu.getAttribute('aria-controls')!);
      expect(panel?.contains(link.element())).toBe(true);
    });

    it('at 1024px is visible in the banner, after the actions, and the header stays 48px', async () => {
      await page.viewport(1024, 768);
      const actions = createRawSnippet(() => ({ render: () => '<button>Publish</button>' }));
      render(SiteHeader, { user: null, actions });
      const banner = page.getByRole('banner');
      const link = banner.getByRole('link', { name: 'Sign in' });
      await expect.element(link).toBeVisible();
      const a = banner.getByRole('button', { name: 'Publish' }).element().getBoundingClientRect();
      const l = link.element().getBoundingClientRect();
      expect(l.left).toBeGreaterThanOrEqual(a.right);
      expect(banner.element().getBoundingClientRect().height).toBe(48);
    });
  });

  describe('About entry', () => {
    it('at 1024px links /about, right after the account entry', async () => {
      await page.viewport(1024, 768);
      render(SiteHeader, { user: null });
      const banner = page.getByRole('banner');
      const about = banner.getByRole('link', { name: 'About', exact: true });
      await expect.element(about).toBeVisible();
      await expect.element(about).toHaveAttribute('href', '/about');
      const signIn = banner.getByRole('link', { name: 'Sign in' }).element();
      expect(about.element().getBoundingClientRect().left).toBeGreaterThanOrEqual(
        signIn.getBoundingClientRect().right
      );
      expect(banner.element().getBoundingClientRect().height).toBe(48);
    });

    it('at 375px waits in the Menu, then sits in the panel after the account entry', async () => {
      await page.viewport(375, 812);
      render(SiteHeader, { user: null });
      await expect.element(page.getByText('About', { exact: true })).not.toBeVisible();
      await page.getByRole('button', { name: 'Menu' }).click();
      const about = page.getByRole('link', { name: 'About', exact: true });
      await expect.element(about).toBeVisible();
      const menu = page.getByRole('button', { name: 'Menu' }).element();
      const panel = document.getElementById(menu.getAttribute('aria-controls')!);
      expect(panel?.contains(about.element())).toBe(true);
      const signIn = page.getByRole('link', { name: 'Sign in' }).element();
      expect(
        signIn.compareDocumentPosition(about.element()) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    it('is current on /about only', async () => {
      await page.viewport(1024, 768);
      const { rerender } = await render(SiteHeader, { routeId: '/about' });
      const about = page.getByRole('banner').getByRole('link', { name: 'About', exact: true });
      await expect.element(about).toHaveAttribute('aria-current', 'page');
      await rerender({ routeId: '/sim' });
      await expect.element(about).not.toHaveAttribute('aria-current');
    });
  });

  describe('signed in with a long handle', () => {
    const handle = 'a-very-long-handle-that-will-not-fit-in-the-header';
    const actions = createRawSnippet(() => ({
      render: () => '<span><button>Publish</button></span>'
    }));
    const pinned = createRawSnippet(() => ({
      render: () => '<button>Room for 47,335 homes</button>'
    }));

    // Paint's header (one action, Publish). /sim's, signed in at 1024 with the playhead at the
    // end, is asserted in SimPage.svelte.spec.ts and e2e/map-key.spec.ts. From lg to xl the
    // handle is capped at 96 px (the fit ladder's step 2: a touch laptop's row at 1024), from xl
    // at 160 px; its full text stays the name and the title.
    for (const [width, cap] of [
      [1024, 96],
      [1280, 160]
    ])
      it(`at ${width}px the header does not overflow and the handle is capped at ${cap}px`, async () => {
        await page.viewport(width, 800);
        render(SiteHeader, { routeId: '/', user: { handle }, actions, pinned });
        const banner = page.getByRole('banner');
        const account = banner.getByRole('link', { name: `@${handle}` });
        await expect.element(account).toBeVisible();
        await expect.element(account).toHaveAttribute('title', `@${handle}`);
        expect(account.element().getBoundingClientRect().width).toBeLessThanOrEqual(cap);
        const el = banner.element() as HTMLElement;
        expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth);
      });
  });

  it('fits at 375px with three 24px actions and no banner overflow', async () => {
    await page.viewport(375, 812);
    const actions = createRawSnippet(() => ({
      render: () =>
        '<span><button style="width:24px;height:24px">A</button>' +
        '<button style="width:24px;height:24px">B</button>' +
        '<button style="width:24px;height:24px">C</button></span>'
    }));
    render(SiteHeader, { routeId: '/', actions });
    const banner = page.getByRole('banner');
    await expect.element(banner).toBeVisible();
    const el = banner.element() as HTMLElement;
    expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth);
  });

  it('focusHeaderMenu focuses the phone Menu button, and is false without one', async () => {
    expect(focusHeaderMenu()).toBe(false);
    await page.viewport(375, 700);
    render(SiteHeader);
    expect(focusHeaderMenu()).toBe(true);
    await expect.element(page.getByRole('button', { name: 'Menu' })).toHaveFocus();
  });

  describe('phone menu', () => {
    const actions = createRawSnippet(() => ({
      render: () =>
        '<span><button>Example</button>' + '<button aria-expanded="false">Options</button></span>'
    }));
    const pinned = createRawSnippet(() => ({ render: () => '<button>1,234 homes added</button>' }));
    const menu = () => page.getByRole('button', { name: 'Menu' });

    it('at 375px hides the links and actions until Menu is pressed; the pinned item shows', async () => {
      await page.viewport(375, 812);
      render(SiteHeader, { routeId: '/sim', actions, pinned });
      const banner = page.getByRole('banner');
      await expect.element(banner.getByRole('button', { name: '1,234 homes added' })).toBeVisible();
      await expect.element(menu()).toHaveAttribute('aria-expanded', 'false');
      await expect.element(page.getByText('Example')).not.toBeVisible();
      // The About link waits in the Menu below lg.
      expect(page.getByRole('link', { name: 'About', exact: true }).elements()).toEqual([]);

      await menu().click();
      await expect.element(menu()).toHaveAttribute('aria-expanded', 'true');
      const panel = document.getElementById(menu().element().getAttribute('aria-controls')!);
      expect(panel).not.toBeNull();
      await expect.element(page.getByRole('button', { name: 'Example' })).toBeVisible();
      await expect.element(page.getByRole('link', { name: 'About', exact: true })).toBeVisible();
      await expect.element(banner.getByRole('button', { name: '1,234 homes added' })).toBeVisible();
      const el = banner.element() as HTMLElement;
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
      expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth);
    });

    it('at 375px keeps the order status, pinned, Menu', async () => {
      await page.viewport(375, 812);
      const st = createRawSnippet(() => ({ render: () => '<span data-testid="st">saved</span>' }));
      render(SiteHeader, { routeId: '/sim', actions, pinned, status: st });
      const x = (el: Element) => el.getBoundingClientRect().left;
      const status = page.getByTestId('st').element();
      const score = page.getByRole('button', { name: '1,234 homes added' }).element();
      const m = menu().element();
      expect(x(status)).toBeLessThan(x(score));
      expect(x(score)).toBeLessThan(x(m));
    });

    it('at 375px with a pinned item the site name waits in the Menu', async () => {
      await page.viewport(375, 812);
      render(SiteHeader, { routeId: '/sim', actions, pinned });
      const name = () => page.getByRole('link', { name: 'SF Housing', exact: true });
      await expect.element(menu()).toBeVisible();
      expect(name().elements()).toEqual([]);
      await menu().click();
      await expect.element(name()).toBeVisible();
      const panel = document.getElementById(menu().element().getAttribute('aria-controls')!)!;
      expect(panel.contains(name().element())).toBe(true);
      // Before the actions.
      const about = page.getByRole('link', { name: 'About', exact: true }).element();
      expect(
        name().element().compareDocumentPosition(about) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(name().element()).toHaveAttribute('href', '/');
    });

    for (const width of [640, 768, 1024]) {
      it(`at ${width}px with a pinned item the site name stays in the bar`, async () => {
        await page.viewport(width, 800);
        render(SiteHeader, { routeId: '/sim', actions, pinned });
        const name = page.getByRole('link', { name: 'SF Housing', exact: true });
        await expect.element(name).toBeVisible();
        if (width < 1024) {
          const button = document.querySelector('[data-header-menu]')!;
          const panel = document.getElementById(button.getAttribute('aria-controls')!)!;
          expect(panel.contains(name.element())).toBe(false);
          await menu().click();
          await expect
            .element(page.getByRole('link', { name: 'About', exact: true }))
            .toBeVisible();
          // Still one: the panel's copy stays hidden from sm.
          expect(
            page.getByRole('link', { name: 'SF Housing', exact: true }).elements()
          ).toHaveLength(1);
        }
      });
    }

    const long = createRawSnippet(() => ({
      render: () => `<span>${'Saved a very long time ago '.repeat(12)}</span>`
    }));

    it('centres the score at 1280px even with a long status', async () => {
      await page.viewport(1280, 800);
      render(SiteHeader, { routeId: '/sim', actions, pinned, status: long });
      const r = page
        .getByRole('button', { name: '1,234 homes added' })
        .element()
        .getBoundingClientRect();
      const h = page.getByRole('banner').element().getBoundingClientRect();
      expect(Math.abs((r.left + r.right) / 2 - (h.left + h.right) / 2)).toBeLessThan(1);
    });

    it('at 1024px with a long status the score sits between the status and the actions', async () => {
      await page.viewport(1024, 768);
      render(SiteHeader, { routeId: '/sim', actions, pinned, status: long });
      const banner = page.getByRole('banner').element() as HTMLElement;
      const slot = document.querySelector<HTMLElement>('[data-header-status]')!;
      // What a person sees: the status content, not the slot (which can shrink under it).
      const content = slot.firstElementChild!.getBoundingClientRect();
      const score = page
        .getByRole('button', { name: '1,234 homes added' })
        .element()
        .getBoundingClientRect();
      const other = page.getByRole('button', { name: 'Example' }).element().getBoundingClientRect();
      expect(content.right).toBeLessThanOrEqual(score.left);
      expect(slot.scrollWidth).toBeLessThanOrEqual(slot.clientWidth);
      expect(score.right).toBeLessThanOrEqual(other.left);
      expect(banner.getBoundingClientRect().height).toBe(48);
      expect(banner.scrollWidth).toBeLessThanOrEqual(banner.clientWidth);
    });

    it('Escape closes the menu and returns focus to Menu', async () => {
      await page.viewport(375, 812);
      render(SiteHeader, { routeId: '/sim', actions, pinned });
      await menu().click();
      (page.getByRole('link', { name: 'About', exact: true }).element() as HTMLElement).focus();
      await userEvent.keyboard('{Escape}');
      await expect.element(menu()).toHaveAttribute('aria-expanded', 'false');
      await expect.element(menu()).toHaveFocus();
      await expect.element(page.getByText('Example')).not.toBeVisible();
    });

    it('choosing a plain button closes the menu; a disclosure inside keeps it open', async () => {
      await page.viewport(375, 812);
      render(SiteHeader, { routeId: '/sim', actions, pinned });
      await menu().click();
      await page.getByRole('button', { name: 'Options' }).click();
      await expect.element(menu()).toHaveAttribute('aria-expanded', 'true');
      await page.getByRole('button', { name: 'Example' }).click();
      await expect.element(menu()).toHaveAttribute('aria-expanded', 'false');
      await expect.element(page.getByText('Example')).not.toBeVisible();
    });

    it('Escape leaves the menu open while a disclosure inside it is open', async () => {
      await page.viewport(375, 812);
      render(SiteHeader, { routeId: '/sim', actions, pinned });
      await menu().click();
      const options = page.getByRole('button', { name: 'Options' }).element();
      options.setAttribute('aria-expanded', 'true');
      (options as HTMLElement).focus();
      await userEvent.keyboard('{Escape}');
      await expect.element(menu()).toHaveAttribute('aria-expanded', 'true');
      options.setAttribute('aria-expanded', 'false');
      await userEvent.keyboard('{Escape}');
      await expect.element(menu()).toHaveAttribute('aria-expanded', 'false');
    });

    it('a button inside a dialog opened from the menu keeps the menu (and the dialog) open', async () => {
      await page.viewport(375, 812);
      const withDialog = createRawSnippet(() => ({
        render: () =>
          '<span><button aria-haspopup="dialog">Publish</button>' +
          '<dialog><button>Send</button></dialog></span>'
      }));
      render(SiteHeader, { routeId: '/', actions: withDialog });
      await menu().click();
      const dlg = document.querySelector('dialog') as HTMLDialogElement;
      await page.getByRole('button', { name: 'Publish' }).click();
      dlg.showModal();
      await page.getByRole('button', { name: 'Send' }).click();
      await expect.element(menu()).toHaveAttribute('aria-expanded', 'true');
      await expect.element(page.getByRole('button', { name: 'Send' })).toBeVisible();
      dlg.close();
    });

    it('the Menu button is at least 24x24', async () => {
      await page.viewport(375, 812);
      render(SiteHeader, { routeId: '/' });
      const r = menu().element().getBoundingClientRect();
      expect(r.width).toBeGreaterThanOrEqual(24);
      expect(r.height).toBeGreaterThanOrEqual(24);
    });

    it('the Menu button is a hamburger icon named "Menu"', async () => {
      await page.viewport(375, 812);
      render(SiteHeader, { routeId: '/' });
      const el = menu().element() as HTMLElement;
      expect(el.getAttribute('aria-label')).toBe('Menu');
      expect(el.textContent?.trim()).toBe('');
      const svg = el.querySelector('svg');
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
      expect(svg?.querySelectorAll('path, line, rect').length).toBeGreaterThanOrEqual(1);
      const r = el.getBoundingClientRect();
      expect(r.width).toBeGreaterThanOrEqual(24);
      expect(r.height).toBeGreaterThanOrEqual(24);
    });

    describe('status slot', () => {
      const status = createRawSnippet(() => ({
        render: () => '<div data-testid="status-slot"></div>'
      }));
      const wide = createRawSnippet(() => ({
        // As HeaderScore renders it: "added" is visually hidden below lg.
        render: () =>
          '<button class="rounded-md border px-2 text-sm font-semibold whitespace-nowrap">' +
          '12,345 homes <span class="max-lg:sr-only">added</span></button>'
      }));

      it('from lg it sits right after the name link, left of the actions', async () => {
        await page.viewport(1024, 768);
        render(SiteHeader, { routeId: '/sim', actions, pinned, status });
        const slot = page.getByTestId('status-slot').element();
        const lastLink = page.getByRole('link', { name: 'SF Housing', exact: true }).element();
        const score = page.getByRole('button', { name: '1,234 homes added' }).element();
        expect(
          lastLink.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
        const s = slot.getBoundingClientRect();
        expect(s.left).toBeGreaterThanOrEqual(lastLink.getBoundingClientRect().right);
        expect(s.left - lastLink.getBoundingClientRect().right).toBeLessThanOrEqual(24);
        expect(s.right).toBeLessThanOrEqual(score.getBoundingClientRect().left);
      });

      // The /sim row as it renders from lg: the real chip, the score bar and the widest actions
      // (Setup's; the map's layers are on the map, not here).
      const btn = 'min-h-6 min-w-6 rounded-md border px-2 text-sm font-medium whitespace-nowrap';
      const simActions = createRawSnippet(() => ({
        render: () =>
          `<div class="contents"><button class="${btn}">Policy</button>` +
          `<button class="${btn} bg-accent text-on-accent">Share link</button></div>`
      }));
      for (const width of [1024, 1280]) {
        it(`at ${width}px "Autosave off", the nav and every action fit without overlap`, async () => {
          await page.viewport(width, 768);
          // The real score, with the delta a run that compares with the FZP shows.
          render(HeaderScoreHeader, {
            props: { actions: simActions, status, total: 12345, delta: 12345 }
          });
          const host = page.getByTestId('status-slot').element() as HTMLElement;
          const a = mount(SaveIndicator, {
            target: host,
            props: { status: 'off', align: 'start' }
          });
          try {
            const chip = page.getByRole('button', { name: 'Autosave off' });
            await expect.element(chip).toBeVisible();
            const banner = page.getByRole('banner').element() as HTMLElement;
            expect(banner.getBoundingClientRect().height).toBe(48);
            expect(banner.scrollWidth).toBeLessThanOrEqual(banner.clientWidth);
            expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
            const box = (el: Element) => el.getBoundingClientRect();
            const row = [
              page.getByRole('link', { name: 'SF Housing', exact: true }).element(),
              chip.element(),
              page.getByRole('button', { name: '12,345 homes added' }).element(),
              page.getByRole('button', { name: 'Policy' }).element(),
              page.getByRole('button', { name: 'Share link' }).element(),
              page.getByRole('link', { name: 'Sign in' }).element(),
              page.getByRole('link', { name: 'About', exact: true }).element()
            ];
            for (let i = 1; i < row.length; i++)
              expect(box(row[i]).left, `item ${i} after item ${i - 1}`).toBeGreaterThanOrEqual(
                box(row[i - 1]).right
              );
            expect(box(row.at(-1)!).right).toBeLessThanOrEqual(width);
          } finally {
            await unmount(a);
          }
        });
      }

      for (const width of [768])
        it(`at ${width}px every action is in the Menu and the header does not overflow`, async () => {
          await page.viewport(width, 768);
          render(SiteHeader, { routeId: '/sim', actions: simActions, pinned: wide, status });
          const host = page.getByTestId('status-slot').element() as HTMLElement;
          const a = mount(SaveIndicator, {
            target: host,
            props: { status: 'off', align: 'start' }
          });
          try {
            const banner = page.getByRole('banner').element() as HTMLElement;
            await expect.element(page.getByRole('button', { name: 'Autosave off' })).toBeVisible();
            await expect
              .element(page.getByRole('button', { name: '12,345 homes added' }))
              .toBeVisible();
            await expect.element(page.getByText('Share link')).not.toBeVisible();
            await page.getByRole('button', { name: 'Menu' }).click();
            for (const name of ['Policy', 'Share link'])
              await expect.element(page.getByRole('button', { name })).toBeVisible();
            expect(banner.getBoundingClientRect().height).toBe(48);
            expect(banner.scrollWidth).toBeLessThanOrEqual(banner.clientWidth);
            expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
            const chip = page.getByRole('button', { name: 'Autosave off' }).element();
            const score = page.getByRole('button', { name: '12,345 homes added' }).element();
            const menuBtn = page.getByRole('button', { name: 'Menu' }).element();
            expect(chip.getBoundingClientRect().right).toBeLessThanOrEqual(
              score.getBoundingClientRect().left
            );
            expect(score.getBoundingClientRect().right).toBeLessThanOrEqual(
              menuBtn.getBoundingClientRect().left
            );
          } finally {
            await unmount(a);
          }
        });

      it('at 375px it leads the bar (the site title waits in the Menu), outside the Menu', async () => {
        await page.viewport(375, 812);
        render(HeaderScoreHeader, { props: { actions, status, total: 12345, delta: 12345 } });
        const host = page.getByTestId('status-slot').element() as HTMLElement;
        const a = mount(SaveIndicator, { target: host, props: { status: 'off', align: 'start' } });
        try {
          const chip = page.getByRole('button', { name: 'Autosave off' });
          await expect.element(chip).toBeVisible();
          expect(page.getByRole('link', { name: 'SF Housing', exact: true }).elements()).toEqual(
            []
          );
          const c = chip.element().getBoundingClientRect();
          const bar = page.getByRole('banner').element().getBoundingClientRect();
          expect(c.left).toBeGreaterThanOrEqual(bar.left);
          expect(c.left - bar.left).toBeLessThanOrEqual(24);
          expect(c.right).toBeLessThanOrEqual(
            page
              .getByRole('button', { name: '12,345 homes added' })
              .element()
              .getBoundingClientRect().left
          );
          const panel = document.getElementById(menu().element().getAttribute('aria-controls')!);
          expect(panel?.contains(host)).toBe(false);
          // The widest states fit: no horizontal scroll, header still one 48 px row.
          const banner = page.getByRole('banner').element() as HTMLElement;
          expect(banner.getBoundingClientRect().height).toBe(48);
          expect(banner.scrollWidth).toBeLessThanOrEqual(banner.clientWidth);
          expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
          expect(menu().element().getBoundingClientRect().right).toBeLessThanOrEqual(375);
          // The Autosave off popover opens inside the viewport.
          await chip.click();
          const pop = page.getByText(/isn't letting this site save/).element();
          const p = pop.getBoundingClientRect();
          expect(p.left).toBeGreaterThanOrEqual(0);
          expect(p.right).toBeLessThanOrEqual(375);
        } finally {
          await unmount(a);
        }
      });
    });

    it('at 1024px there is no Menu; the pinned item sits before the actions', async () => {
      await page.viewport(1024, 768);
      render(SiteHeader, { routeId: '/sim', actions, pinned });
      await expect.element(page.getByRole('button', { name: 'Example' })).toBeVisible();
      expect(page.getByRole('button', { name: 'Menu' }).elements()).toEqual([]);
      const score = page.getByRole('button', { name: '1,234 homes added' }).element();
      const other = page.getByRole('button', { name: 'Example' }).element();
      expect(score.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(score.getBoundingClientRect().right).toBeLessThanOrEqual(
        other.getBoundingClientRect().left
      );
    });

    it('centres the pinned item in the header from xl', async () => {
      await page.viewport(1280, 800);
      render(SiteHeader, { routeId: '/sim', actions, pinned });
      await expect.element(page.getByRole('button', { name: '1,234 homes added' })).toBeVisible();
      const score = page.getByRole('button', { name: '1,234 homes added' }).element();
      const rect = score.getBoundingClientRect();
      const header = page.getByRole('banner').element().getBoundingClientRect();
      expect(
        Math.abs((rect.left + rect.right) / 2 - (header.left + header.right) / 2)
      ).toBeLessThan(1);
    });

    it('centres the score at 1024px when both sides fit', async () => {
      await page.viewport(1024, 768);
      render(HeaderScoreHeader, { props: { total: 12345, delta: 1817 } });
      const box = page.getByTestId('score-bar').element().parentElement!.getBoundingClientRect();
      const banner = page.getByRole('banner').element().getBoundingClientRect();
      expect(Math.abs((box.left + box.right) / 2 - (banner.left + banner.right) / 2)).toBeLessThan(
        1
      );
    });

    // /sim's widest row from lg on a fine-only pointer (no Undo or Redo): a 20-character handle,
    // a five-digit headline with its delta, "Autosave off" with "Updating" beside it.
    const row = () => {
      const handle = 'a-very-long-handle-x';
      return [
        page.getByRole('link', { name: 'SF Housing', exact: true }).element(),
        page.getByRole('button', { name: 'Autosave off' }).element(),
        page.getByText('Updating', { exact: true }).element(),
        page.getByTestId('score-bar').element().parentElement!,
        page.getByRole('button', { name: 'Publish' }).element(),
        page.getByRole('link', { name: `@${handle}` }).element(),
        page.getByRole('link', { name: 'About', exact: true }).element()
      ];
    };
    const expectRowFits = async (width: number) => {
      await page.viewport(width, 800);
      render(SimRowHeader, { props: { user: { handle: 'a-very-long-handle-x' } } });
      await expect.element(page.getByRole('button', { name: 'Publish' })).toBeVisible();
      await expect.element(page.getByRole('button', { name: 'Autosave off' })).toBeVisible();
      expect(page.getByRole('button', { name: 'Keyboard shortcuts' }).elements()).toEqual([]);
      const items = row();
      const box = (el: Element) => el.getBoundingClientRect();
      for (let i = 1; i < items.length; i++)
        expect(box(items[i]).left, `item ${i} after item ${i - 1}`).toBeGreaterThanOrEqual(
          box(items[i - 1]).right
        );
      expect(box(items.at(-1)!).right).toBeLessThanOrEqual(width);
      const banner = page.getByRole('banner').element() as HTMLElement;
      expect(banner.getBoundingClientRect().height).toBe(48);
      expect(banner.scrollWidth).toBeLessThanOrEqual(banner.clientWidth);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      const score = box(items[3]);
      const b = box(banner);
      return Math.abs((score.left + score.right) / 2 - (b.left + b.right) / 2);
    };

    it('at 1024px the widest /sim row fits in order', async () => {
      expect(await expectRowFits(1024)).toBeLessThan(1);
    });

    it('at 1024px a touch laptop adds Undo and Redo: one row, in order, nothing squeezed', async () => {
      await page.viewport(1024, 800);
      render(SimRowHeader, { props: { user: { handle: 'a-very-long-handle-x' }, touch: true } });
      const undo = page.getByRole('button', { name: /^Undo/ });
      await expect.element(undo).toBeVisible();
      expect(page.getByRole('button', { name: 'Keyboard shortcuts' }).elements()).toEqual([]);
      const items = [
        page.getByTestId('score-bar').element().parentElement!,
        undo.element(),
        page.getByRole('button', { name: /^Redo/ }).element(),
        page.getByRole('button', { name: 'Publish' }).element(),
        page.getByRole('link', { name: '@a-very-long-handle-x' }).element(),
        page.getByRole('link', { name: 'About', exact: true }).element()
      ];
      const box = (el: Element) => el.getBoundingClientRect();
      for (let i = 0; i < items.length; i++) {
        if (i > 0)
          expect(box(items[i]).left, `item ${i} after item ${i - 1}`).toBeGreaterThanOrEqual(
            box(items[i - 1]).right
          );
        // Not squeezed: each item, the score (which clips its text) first, keeps its content's
        // width.
        const el = items[i] as HTMLElement;
        expect(el.scrollWidth, `item ${i} clips`).toBeLessThanOrEqual(el.clientWidth + 0.5);
      }
      expect(box(items[1]).top).toBe(box(items[2]).top);
      const banner = page.getByRole('banner').element() as HTMLElement;
      expect(banner.getBoundingClientRect().height).toBe(48);
      expect(banner.scrollWidth).toBeLessThanOrEqual(banner.clientWidth);
      const score = box(items[0]);
      const b = box(banner);
      expect(Math.abs((score.left + score.right) / 2 - (b.left + b.right) / 2)).toBeLessThan(1);
    });

    it('at 1280px the same row fits and the score is centred', async () => {
      expect(await expectRowFits(1280)).toBeLessThan(1);
    });

    // The same row with the game's unit count.
    for (const touch of [false, true])
      it(`at 1024px with the unit count${touch ? ' on a touch laptop' : ''} the row fits`, async () => {
        await page.viewport(1024, 800);
        const { game } = seededGame({
          state: { phase: 'runs', firstWinAt: WON, units: { home: 12345 } }
        });
        render(SimRowGameHeader, {
          props: { game, user: { handle: 'a-very-long-handle-x' }, touch }
        });
        await expect.element(page.getByTestId('header-units')).toBeVisible();
        const banner = page.getByRole('banner').element() as HTMLElement;
        const box = (el: Element) => el.getBoundingClientRect();
        const items = [
          page.getByTestId('header-units').element(),
          page.getByTestId('score-bar').element().parentElement!,
          page.getByRole('button', { name: 'Publish' }).element(),
          page.getByRole('link', { name: '@a-very-long-handle-x' }).element(),
          page.getByRole('link', { name: 'About', exact: true }).element()
        ];
        const overlap = items.map((el, i) =>
          i === 0 ? 0 : box(items[i - 1]).right - box(el).left
        );
        expect(Math.max(...overlap), `overlaps ${overlap}`).toBeLessThanOrEqual(0);
        expect(banner.getBoundingClientRect().height).toBe(48);
        expect(
          banner.scrollWidth - banner.clientWidth,
          `overflow; items ${items.map((el) => `${box(el).left}-${box(el).right}`)}`
        ).toBeLessThanOrEqual(0);
        expect(box(items.at(-1)!).right).toBeLessThanOrEqual(1024);
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1024);
      });
  });

  describe('the game', () => {
    for (const width of [375, 800, 1024, 1280])
      it(`at ${width}px there is no Steps navigation, no link to /sim, and the name reads SF Housing`, async () => {
        await page.viewport(width, 800);
        render(GameHeaderHost, { game: seededGame().game, routeId: '/' });
        const name = page
          .getByRole('banner')
          .getByRole('link', { name: 'SF Housing', exact: true });
        await expect.element(name).toBeVisible();
        expect(name.element().textContent?.trim()).toBe('SF Housing');
        if (width < 1024) await page.getByRole('button', { name: 'Menu' }).click();
        expect(page.getByRole('navigation', { name: 'Steps' }).elements()).toEqual([]);
        expect(document.querySelector('a[href="/sim"]')).toBeNull();
        expect(document.querySelector('[data-step-number], [data-step-locked]')).toBeNull();
      });

    it('at 375px with a pinned item the Menu names the site SF Housing', async () => {
      await page.viewport(375, 812);
      render(HeaderScoreHeader, { props: { total: 1234 } });
      const menu = page.getByRole('button', { name: 'Menu', exact: true });
      await expect.element(menu).toBeVisible();
      expect(page.getByRole('link', { name: 'SF Housing', exact: true }).elements()).toEqual([]);
      await menu.click();
      const name = page.getByRole('link', { name: 'SF Housing', exact: true });
      await expect.element(name).toBeVisible();
      const panel = document.getElementById(menu.element().getAttribute('aria-controls')!)!;
      expect(panel.contains(name.element())).toBe(true);
    });

    it('at 1024px the unit count sits in the bar after the name, before the status', async () => {
      await page.viewport(1024, 800);
      render(GameHeaderHost, { game: seededGame().game, routeId: '/' });
      const units = page.getByTestId('header-units');
      await expect.element(units).toBeVisible();
      const name = page.getByRole('link', { name: 'SF Housing', exact: true }).element();
      const status = document.querySelector('[data-header-status]')!;
      expect(units.element().getBoundingClientRect().left).toBeGreaterThanOrEqual(
        name.getBoundingClientRect().right
      );
      expect(units.element().getBoundingClientRect().right).toBeLessThanOrEqual(
        status.getBoundingClientRect().left + 0.5
      );
    });

    it('at 800px the unit count waits in the Menu and shows when it opens', async () => {
      await page.viewport(800, 800);
      render(GameHeaderHost, { game: seededGame().game, routeId: '/' });
      const menu = page.getByRole('button', { name: 'Menu', exact: true });
      await expect.element(menu).toBeVisible();
      await expect.element(page.getByTestId('header-units')).not.toBeVisible();
      await menu.click();
      await expect.element(page.getByTestId('header-units')).toBeVisible();
      const panel = document.getElementById(menu.element().getAttribute('aria-controls')!)!;
      expect(panel.contains(page.getByTestId('header-units').element())).toBe(true);
    });

    it('the open game has no unit count', async () => {
      await page.viewport(1280, 800);
      render(SiteHeader, { routeId: '/' });
      await expect.element(page.getByRole('link', { name: 'About', exact: true })).toBeVisible();
      expect(page.getByTestId('header-units').elements()).toEqual([]);
    });

    it('the Menu button is named Menu and has no dot, whatever the game holds', async () => {
      await page.viewport(800, 800);
      const { game } = seededGame({
        state: { phase: 'runs', firstWinAt: WON, units: { home: 500 } }
      });
      render(GameHeaderHost, { game, routeId: '/' });
      await expect.element(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
      expect(document.querySelector('[data-level-dot]')).toBeNull();
    });

    it('a button inside data-header-keep-open leaves the Menu open; a link closes it', async () => {
      await page.viewport(800, 800);
      render(GameHeaderHost, { game: seededGame().game, routeId: '/' });
      const menu = page.getByRole('button', { name: 'Menu', exact: true });
      await menu.click();
      await page.getByTestId('header-units').click();
      await expect.element(menu).toHaveAttribute('aria-expanded', 'true');
      const about = page.getByRole('link', { name: 'About', exact: true }).element();
      about.addEventListener('click', (e) => e.preventDefault(), { once: true });
      (about as HTMLElement).click();
      await expect.element(menu).toHaveAttribute('aria-expanded', 'false');
    });

    const HEADLINE = {
      homes: 61400,
      amount: 82069,
      deadline: 'Dec 2055',
      unlocks: null,
      met: false,
      side: []
    };
    for (const width of [375, 1280])
      it(`at ${width}px the header is positioned, the pinned box is not, and both GoalHeadline root nodes sit in it`, async () => {
        await page.viewport(width, 800);
        render(GoalPinnedHeader, { game: seededGame().game, headline: HEADLINE });
        const headline = page.getByTestId('goal-headline');
        await expect.element(headline).toBeVisible();
        const banner = page.getByRole('banner').element() as HTMLElement;
        const slot = headline.element().parentElement!;
        expect(slot.parentElement).toBe(banner);
        expect(page.getByTestId('goal-live').element().parentElement).toBe(slot);
        expect(getComputedStyle(banner).position).toBe('relative');
        expect(getComputedStyle(slot).position).toBe('static');
        await page.getByTestId('goal-headline-button').click();
        const pop = page.getByTestId('side-goals');
        await expect.element(pop).toBeVisible();
        expect((pop.element() as HTMLElement).offsetParent).toBe(banner);
        const p = pop.element().getBoundingClientRect();
        const b = banner.getBoundingClientRect();
        expect(p.top).toBeGreaterThanOrEqual(b.bottom);
        expect(p.left).toBeGreaterThanOrEqual(b.left + 16 - 0.5);
        expect(p.right).toBeLessThanOrEqual(b.right - 16 + 0.5);
      });

    it("the account entry reads @handle from the layout's user first", async () => {
      await page.viewport(1280, 800);
      const sync = quietSync({ handle: 'bob', handleClaimed: true });
      render(GameHeaderHost, {
        game: seededGame({ sync }).game,
        routeId: '/',
        user: { handle: 'ada' }
      });
      const link = page.getByRole('link', { name: '@ada' });
      await expect.element(link).toHaveAttribute('href', '/account');
      expect(page.getByRole('link', { name: '@bob' }).elements()).toHaveLength(0);
    });

    it("with no user, the account entry reads the sync's account, whatever signInAvailable says", async () => {
      await page.viewport(1280, 800);
      const sync = quietSync({ handle: 'bob', handleClaimed: true });
      render(GameHeaderHost, {
        game: seededGame({ sync }).game,
        routeId: '/',
        signInAvailable: false
      });
      await expect
        .element(page.getByRole('link', { name: '@bob' }))
        .toHaveAttribute('href', '/account');
    });

    it('with neither, Sign in links /signin while a method is in effect', async () => {
      await page.viewport(1280, 800);
      render(GameHeaderHost, { game: seededGame().game, routeId: '/' });
      await expect
        .element(page.getByRole('link', { name: 'Sign in' }))
        .toHaveAttribute('href', '/signin');
    });

    it('with neither and no sign-in method, there is no account entry', async () => {
      await page.viewport(1280, 800);
      render(GameHeaderHost, {
        game: seededGame().game,
        routeId: '/',
        signInAvailable: false
      });
      await expect.element(page.getByRole('link', { name: 'About' })).toBeVisible();
      expect(document.querySelector('[data-header-account]')).toBeNull();
    });
  });
});
