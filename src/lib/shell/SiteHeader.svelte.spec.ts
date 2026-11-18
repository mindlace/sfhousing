import { createRawSnippet, mount, unmount } from 'svelte';
import SaveIndicator from '$lib/sharing/SaveIndicator.svelte';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { focusHeaderMenu } from './header-actions.svelte';
import SiteHeader from './SiteHeader.svelte';
import HeaderScoreHeader from './test/HeaderScoreHeader.svelte';
import HistoryHeader from './test/HistoryHeader.svelte';

describe('SiteHeader', () => {
  it('renders a banner with a home link', async () => {
    render(SiteHeader);
    const banner = page.getByRole('banner');
    await expect.element(banner).toBeVisible();
    const link = banner.getByRole('link', { name: 'SF Housing Simulator' });
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

  describe('steps', () => {
    const numbers = () => Array.from(document.querySelectorAll<HTMLElement>('[data-step-number]'));
    const shown = (el: HTMLElement) => el.checkVisibility({ checkVisibilityCSS: true });

    it('at 1280px the Steps nav is an ordered list of Paint then Simulate, with visible numbers', async () => {
      await page.viewport(1280, 800);
      render(SiteHeader, { routeId: '/' });
      const nav = page.getByRole('navigation', { name: 'Steps' });
      await expect.element(nav.getByRole('link', { name: 'Paint', exact: true })).toBeVisible();
      const el = nav.element();
      expect(el.querySelectorAll('ol > li')).toHaveLength(2);
      const links = nav.getByRole('link').elements() as HTMLElement[];
      expect(links.map((a) => a.textContent?.replace(/^\d/, ''))).toEqual(['Paint', 'Simulate']);
      const nums = Array.from(el.querySelectorAll<HTMLElement>('[data-step-number]'));
      expect(nums.map((n) => n.textContent)).toEqual(['1', '2']);
      expect(nums.every(shown)).toBe(true);
      expect(nums.every((n) => n.getAttribute('aria-hidden') === 'true')).toBe(true);
      await expect
        .element(nav.getByRole('link', { name: 'Paint' }))
        .toHaveAttribute('aria-current', 'page');
      await expect
        .element(nav.getByRole('link', { name: 'Simulate' }))
        .not.toHaveAttribute('aria-current');
    });

    it('at 1024px the numbers are hidden and the links keep their widths', async () => {
      await page.viewport(1024, 768);
      render(SiteHeader, { routeId: '/' });
      const nav = page.getByRole('navigation', { name: 'Steps' });
      const paint = nav.getByRole('link', { name: 'Paint' });
      await expect.element(paint).toBeVisible();
      const nums = Array.from(nav.element().querySelectorAll<HTMLElement>('[data-step-number]'));
      expect(nums).toHaveLength(2);
      expect(nums.some(shown)).toBe(false);
      expect(paint.element().getBoundingClientRect().width).toBeLessThanOrEqual(43.5);
      expect(
        nav.getByRole('link', { name: 'Simulate' }).element().getBoundingClientRect().width
      ).toBeLessThanOrEqual(67);
    });

    it('at 375px the Menu holds the two steps with their numbers', async () => {
      await page.viewport(375, 812);
      render(SiteHeader, { routeId: '/' });
      await page.getByRole('button', { name: 'Menu' }).click();
      const nav = page.getByRole('navigation', { name: 'Steps' });
      await expect.element(nav.getByRole('link', { name: 'Paint' })).toBeVisible();
      const nums = Array.from(nav.element().querySelectorAll<HTMLElement>('[data-step-number]'));
      expect(nums.map((n) => n.textContent)).toEqual(['1', '2']);
      expect(nums.every(shown)).toBe(true);
      expect(document.querySelector('a[href="/lesscars"]')).toBeNull();
    });

    it('marks Simulate on /sim, and neither on /p/[id] or /lesscars', async () => {
      await page.viewport(1280, 800);
      const { rerender } = await render(SiteHeader, { routeId: '/sim' });
      const nav = page.getByRole('navigation', { name: 'Steps' });
      const paint = nav.getByRole('link', { name: 'Paint' });
      const simulate = nav.getByRole('link', { name: 'Simulate' });
      await expect.element(paint).not.toHaveAttribute('aria-current');
      await expect.element(simulate).toHaveAttribute('aria-current', 'page');
      for (const routeId of ['/p/[id]', '/lesscars']) {
        await rerender({ routeId });
        await expect.element(paint).toBeVisible();
        await expect.element(paint).not.toHaveAttribute('aria-current');
        await expect.element(simulate).not.toHaveAttribute('aria-current');
      }
    });

    it('the numbers are not part of the names', async () => {
      await page.viewport(1280, 800);
      render(SiteHeader, { routeId: '/' });
      await expect
        .element(page.getByRole('link', { name: 'Paint', exact: true }))
        .toHaveAttribute('href', '/');
      await expect
        .element(page.getByRole('link', { name: 'Simulate', exact: true }))
        .toHaveAttribute('href', '/sim');
      // Two navs (the bar's and the Menu's), two numbers each, all hidden from speech.
      expect(numbers()).toHaveLength(4);
      expect(numbers().every((n) => n.getAttribute('aria-hidden') === 'true')).toBe(true);
    });

    for (const width of [1024, 1280])
      it(`at ${width}px the Steps nav holds Paint and Simulate only`, async () => {
        await page.viewport(width, 768);
        render(SiteHeader, { routeId: '/' });
        const nav = page.getByRole('navigation', { name: 'Steps' });
        await expect.element(nav.getByRole('link', { name: 'Paint' })).toBeVisible();
        const names = nav
          .getByRole('link')
          .elements()
          .map((a) => (a as HTMLElement).innerText);
        expect(names.map((n) => n.replace(/^\d\s*/, ''))).toEqual(['Paint', 'Simulate']);
        expect(document.querySelector('a[href="/lesscars"]')).toBeNull();
      });

    const tabs = async (width: number) => {
      await page.viewport(width, 812);
      render(SiteHeader, { routeId: '/' });
      if (width < 1024) await page.getByRole('button', { name: 'Menu' }).click();
      const nav = page.getByRole('navigation', { name: 'Steps' });
      const current = nav.getByRole('link', { name: 'Paint' });
      const other = nav.getByRole('link', { name: 'Simulate' });
      await expect.element(current).toBeVisible();
      return {
        current: getComputedStyle(current.element()),
        other: getComputedStyle(other.element())
      };
    };

    for (const width of [1024, 375]) {
      it(`at ${width}px the current step is filled, not underlined`, async () => {
        const { current } = await tabs(width);
        expect(current.backgroundColor).toBe('rgb(163, 71, 44)');
        expect(current.textDecorationLine).toBe('none');
      });

      it(`at ${width}px the other step is unfilled, not underlined and looks pressable`, async () => {
        const { other } = await tabs(width);
        expect(other.backgroundColor).toBe('rgba(0, 0, 0, 0)');
        expect(other.textDecorationLine).toBe('none');
        expect(other.borderTopWidth).toBe('1px');
        expect(other.borderTopStyle).toBe('solid');
        expect(other.borderTopColor).not.toBe('rgba(0, 0, 0, 0)');
      });
    }
  });

  describe('brand', () => {
    const suffixOf = () => {
      const link = page.getByRole('banner').getByRole('link', { name: 'SF Housing Simulator' });
      return link.element().querySelector('span') as HTMLElement;
    };

    it('shows "SF Housing" at 375px and keeps the full accessible name', async () => {
      await page.viewport(375, 812);
      render(SiteHeader);
      const link = page.getByRole('banner').getByRole('link', { name: 'SF Housing Simulator' });
      await expect.element(link).toBeVisible();
      expect(link.element().textContent).toBe('SF Housing Simulator');
      // sr-only: " Simulator" is clipped to a 1px box, not rendered
      expect(suffixOf().getBoundingClientRect().width).toBeLessThanOrEqual(1);
    });

    it('shows "SF Housing" only at 1024px and keeps the full accessible name', async () => {
      await page.viewport(1024, 768);
      render(SiteHeader);
      const link = page.getByRole('banner').getByRole('link', { name: 'SF Housing Simulator' });
      await expect.element(link).toBeVisible();
      expect(link.element().textContent).toBe('SF Housing Simulator');
      expect(suffixOf().getBoundingClientRect().width).toBeLessThanOrEqual(1);
    });

    it('shows "SF Housing Simulator" at 1280px', async () => {
      await page.viewport(1280, 800);
      render(SiteHeader);
      await expect
        .element(page.getByRole('banner').getByRole('link', { name: 'SF Housing Simulator' }))
        .toBeVisible();
      expect(suffixOf().getBoundingClientRect().width).toBeGreaterThan(20);
    });
  });

  it('fits at 375px with three 44px actions and no banner overflow', async () => {
    await page.viewport(375, 812);
    const actions = createRawSnippet(() => ({
      render: () =>
        '<span><button style="width:44px;height:44px">A</button>' +
        '<button style="width:44px;height:44px">B</button>' +
        '<button style="width:44px;height:44px">C</button></span>'
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
        '<span><button>Example</button><button aria-expanded="false">View</button></span>'
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
      // Two copies of the links (header row from lg, menu below lg): neither shows.
      expect(page.getByRole('link', { name: 'Paint' }).elements()).toEqual([]);
      expect(page.getByText('Paint').elements()).toHaveLength(2);

      await menu().click();
      await expect.element(menu()).toHaveAttribute('aria-expanded', 'true');
      const panel = document.getElementById(menu().element().getAttribute('aria-controls')!);
      expect(panel).not.toBeNull();
      await expect.element(page.getByRole('button', { name: 'Example' })).toBeVisible();
      await expect.element(page.getByRole('link', { name: 'Paint' })).toBeVisible();
      await expect.element(page.getByRole('link', { name: 'Simulate' })).toBeVisible();
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
      const name = () => page.getByRole('link', { name: 'SF Housing Simulator' });
      await expect.element(menu()).toBeVisible();
      expect(name().elements()).toEqual([]);
      await menu().click();
      await expect.element(name()).toBeVisible();
      const panel = document.getElementById(menu().element().getAttribute('aria-controls')!)!;
      expect(panel.contains(name().element())).toBe(true);
      // Before the steps.
      const paint = page.getByRole('link', { name: 'Paint' }).element();
      expect(
        name().element().compareDocumentPosition(paint) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(name().element()).toHaveAttribute('href', '/');
    });

    for (const width of [640, 768, 1024]) {
      it(`at ${width}px with a pinned item the site name stays in the bar`, async () => {
        await page.viewport(width, 800);
        render(SiteHeader, { routeId: '/sim', actions, pinned });
        const name = page.getByRole('link', { name: 'SF Housing Simulator' });
        await expect.element(name).toBeVisible();
        const button = document.querySelector('[data-header-menu]')!;
        const panel = document.getElementById(button.getAttribute('aria-controls')!)!;
        expect(panel.contains(name.element())).toBe(false);
        if (width < 1024) {
          await menu().click();
          await expect.element(page.getByRole('link', { name: 'Paint' })).toBeVisible();
          // Still one: the panel's copy stays hidden from sm.
          expect(page.getByRole('link', { name: 'SF Housing Simulator' }).elements()).toHaveLength(
            1
          );
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
      (page.getByRole('link', { name: 'Paint' }).element() as HTMLElement).focus();
      await userEvent.keyboard('{Escape}');
      await expect.element(menu()).toHaveAttribute('aria-expanded', 'false');
      await expect.element(menu()).toHaveFocus();
      await expect.element(page.getByText('Example')).not.toBeVisible();
    });

    it('choosing a plain button closes the menu; a disclosure inside keeps it open', async () => {
      await page.viewport(375, 812);
      render(SiteHeader, { routeId: '/sim', actions, pinned });
      await menu().click();
      await page.getByRole('button', { name: 'View' }).click();
      await expect.element(menu()).toHaveAttribute('aria-expanded', 'true');
      await page.getByRole('button', { name: 'Example' }).click();
      await expect.element(menu()).toHaveAttribute('aria-expanded', 'false');
      await expect.element(page.getByText('Example')).not.toBeVisible();
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

      it('from lg it sits right after the last step link, left of the actions', async () => {
        await page.viewport(1024, 768);
        render(SiteHeader, { routeId: '/sim', actions, pinned, status });
        const slot = page.getByTestId('status-slot').element();
        const nav = page.getByRole('navigation', { name: 'Steps' });
        const lastLink = nav.getByRole('link', { name: 'Simulate' }).element();
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
      // (Setup's, with View).
      const btn = 'min-h-6 min-w-6 rounded-md border px-2 text-sm font-medium whitespace-nowrap';
      const simActions = createRawSnippet(() => ({
        render: () =>
          `<div class="contents"><button class="${btn}">View</button>` +
          `<button class="${btn}">Policy</button>` +
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
              page.getByRole('link', { name: /SF Housing/ }).element(),
              page.getByRole('navigation', { name: 'Steps' }).element(),
              chip.element(),
              page.getByRole('button', { name: '12,345 homes added' }).element(),
              page.getByRole('button', { name: 'View' }).element(),
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
            for (const name of ['View', 'Policy', 'Share link'])
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
          expect(page.getByRole('link', { name: /SF Housing/ }).elements()).toEqual([]);
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
  });
});

describe('keyboard shortcuts in the header', () => {
  const shortcuts = () => page.getByRole('button', { name: 'Keyboard shortcuts' });
  const table = () => page.getByRole('table', { name: 'Keyboard shortcuts' });

  for (const width of [1024, 1280])
    it(`at ${width}px opening Keyboard shortcuts moves no header item and the header stays 48 px`, async () => {
      await page.viewport(width, 768);
      render(HistoryHeader);
      await expect.element(shortcuts()).toBeVisible();
      const items = () => [
        page.getByRole('link', { name: /SF Housing/ }).element(),
        page.getByRole('navigation', { name: 'Steps' }).element(),
        page.getByRole('button', { name: '12,345 homes added' }).element(),
        page.getByRole('button', { name: /^Undo/ }).element(),
        page.getByRole('button', { name: /^Redo/ }).element(),
        shortcuts().element(),
        page.getByRole('button', { name: 'Publish' }).element(),
        page.getByRole('link', { name: 'Sign in' }).element()
      ];
      const before = items().map((e) => e.getBoundingClientRect());
      await shortcuts().click();
      await expect.element(table()).toBeVisible();
      items().forEach((e, i) => {
        const r = e.getBoundingClientRect();
        for (const k of ['left', 'top', 'width', 'height'] as const)
          expect(Math.abs(r[k] - before[i][k]), `item ${i} ${k}`).toBeLessThanOrEqual(0.5);
      });
      const banner = page.getByRole('banner').element().getBoundingClientRect();
      expect(banner.height).toBe(48);
      const panel = document.querySelector('[data-testid=shortcuts]')!.getBoundingClientRect();
      expect(panel.top).toBeGreaterThanOrEqual(banner.bottom);
      expect(panel.right).toBeLessThanOrEqual(width);
    });

  it('at 800px in the Menu, Escape closes the shortcuts first and the Menu next', async () => {
    await page.viewport(800, 768);
    render(HistoryHeader);
    const menu = page.getByRole('button', { name: 'Menu' });
    await menu.click();
    await shortcuts().click();
    await expect.element(table()).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByTestId('shortcuts')).not.toBeVisible();
    await expect.element(menu).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Escape}');
    await expect.element(menu).toHaveAttribute('aria-expanded', 'false');
  });
});
