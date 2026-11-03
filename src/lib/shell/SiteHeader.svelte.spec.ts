import { createRawSnippet, mount, unmount } from 'svelte';
import SaveIndicator from '$lib/sharing/SaveIndicator.svelte';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { focusHeaderMenu } from './header-actions.svelte';
import SiteHeader from './SiteHeader.svelte';
import HeaderScoreHeader from './test/HeaderScoreHeader.svelte';

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

  describe('mode links', () => {
    it('shows both links at 1024px and marks the current mode', async () => {
      await page.viewport(1024, 768);
      render(SiteHeader, { routeId: '/' });
      const nav = page.getByRole('navigation', { name: 'Modes' });
      const paint = nav.getByRole('link', { name: 'Paint' });
      const simulate = nav.getByRole('link', { name: 'Simulate' });
      await expect.element(paint).toHaveAttribute('href', '/');
      await expect.element(paint).toHaveAttribute('aria-current', 'page');
      await expect.element(simulate).toHaveAttribute('href', '/sim');
      await expect.element(simulate).not.toHaveAttribute('aria-current');
    });

    it('flips the current link on /sim', async () => {
      await page.viewport(1024, 768);
      render(SiteHeader, { routeId: '/sim' });
      const nav = page.getByRole('navigation', { name: 'Modes' });
      await expect
        .element(nav.getByRole('link', { name: 'Paint' }))
        .not.toHaveAttribute('aria-current');
      await expect
        .element(nav.getByRole('link', { name: 'Simulate' }))
        .toHaveAttribute('aria-current', 'page');
    });

    it('shows both links with neither current on a shared plan', async () => {
      await page.viewport(1024, 768);
      render(SiteHeader, { routeId: '/p/[id]' });
      const nav = page.getByRole('navigation', { name: 'Modes' });
      await expect.element(nav.getByRole('link', { name: 'Paint' })).toBeVisible();
      await expect.element(nav.getByRole('link', { name: 'Simulate' })).toBeVisible();
      await expect
        .element(nav.getByRole('link', { name: 'Paint' }))
        .not.toHaveAttribute('aria-current');
      await expect
        .element(nav.getByRole('link', { name: 'Simulate' }))
        .not.toHaveAttribute('aria-current');
    });

    it('shows Fewer cars at 1024px, pointing at /lesscars and current there', async () => {
      await page.viewport(1024, 768);
      render(SiteHeader, { routeId: '/lesscars' });
      const nav = page.getByRole('navigation', { name: 'Modes' });
      const fewer = nav.getByRole('link', { name: 'Fewer cars' });
      await expect.element(fewer).toHaveAttribute('href', '/lesscars');
      await expect.element(fewer).toHaveAttribute('aria-current', 'page');
      await expect
        .element(nav.getByRole('link', { name: 'Simulate' }))
        .not.toHaveAttribute('aria-current');
    });

    it('puts Fewer cars in the menu at 375px, spelled out', async () => {
      await page.viewport(375, 812);
      render(SiteHeader, { routeId: '/' });
      await page.getByRole('button', { name: 'Menu' }).click();
      const nav = page.getByRole('navigation', { name: 'Modes' });
      const link = nav.getByRole('link', { name: 'Fewer cars' });
      await expect.element(link).toBeVisible();
      expect((link.element() as HTMLElement).innerText).toBe('Fewer cars');
    });

    for (const width of [1024, 1280, 1440]) {
      it(`shows the visible text "Fewer cars" inline at ${width}px`, async () => {
        await page.viewport(width, 768);
        render(SiteHeader, { routeId: '/' });
        const link = page
          .getByRole('navigation', { name: 'Modes' })
          .getByRole('link', { name: 'Fewer cars' });
        await expect.element(link).toBeVisible();
        expect((link.element() as HTMLElement).innerText).toBe('Fewer cars');
        expect(link.element().textContent).toBe('Fewer cars');
      });
    }

    for (const width of [768])
      it(`at ${width}px the links wait in the Menu, with Fewer cars spelled out`, async () => {
        await page.viewport(width, 1024);
        render(SiteHeader, { routeId: '/' });
        await expect
          .element(page.getByRole('link', { name: 'Fewer cars' }))
          .not.toBeInTheDocument();
        await page.getByRole('button', { name: 'Menu' }).click();
        const link = page
          .getByRole('navigation', { name: 'Modes' })
          .getByRole('link', { name: 'Fewer cars' });
        await expect.element(link).toBeVisible();
        expect((link.element() as HTMLElement).innerText).toBe('Fewer cars');
      });

    it('puts both links in the menu at 375px and marks the current mode', async () => {
      await page.viewport(375, 812);
      render(SiteHeader, { routeId: '/sim' });
      await expect.element(page.getByRole('link', { name: 'Paint' })).not.toBeInTheDocument();
      await page.getByRole('button', { name: 'Menu' }).click();
      const nav = page.getByRole('navigation', { name: 'Modes' });
      await expect.element(nav.getByRole('link', { name: 'Paint' })).toBeVisible();
      await expect
        .element(nav.getByRole('link', { name: 'Simulate' }))
        .toHaveAttribute('aria-current', 'page');
    });
  });

  describe('mode tabs', () => {
    const tabs = async (width: number) => {
      await page.viewport(width, 812);
      render(SiteHeader, { routeId: '/' });
      if (width < 1024) await page.getByRole('button', { name: 'Menu' }).click();
      const nav = page.getByRole('navigation', { name: 'Modes' });
      const current = nav.getByRole('link', { name: 'Paint' });
      const other = nav.getByRole('link', { name: 'Simulate' });
      await expect.element(current).toBeVisible();
      return {
        current: getComputedStyle(current.element()),
        other: getComputedStyle(other.element())
      };
    };

    for (const width of [1024, 375]) {
      it(`at ${width}px the current tab is filled, not underlined`, async () => {
        const { current } = await tabs(width);
        expect(current.backgroundColor).toBe('rgb(163, 71, 44)');
        expect(current.textDecorationLine).toBe('none');
      });

      it(`at ${width}px the other tab is unfilled, not underlined and looks pressable`, async () => {
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
        '<span><button>Another future</button><button aria-expanded="false">View</button></span>'
    }));
    const pinned = createRawSnippet(() => ({ render: () => '<button>1,234 homes added</button>' }));
    const menu = () => page.getByRole('button', { name: 'Menu' });

    it('at 375px hides the links and actions until Menu is pressed; the pinned item shows', async () => {
      await page.viewport(375, 812);
      render(SiteHeader, { routeId: '/sim', actions, pinned });
      const banner = page.getByRole('banner');
      await expect.element(banner.getByRole('button', { name: '1,234 homes added' })).toBeVisible();
      await expect.element(menu()).toHaveAttribute('aria-expanded', 'false');
      await expect.element(page.getByText('Another future')).not.toBeVisible();
      // Two copies of the links (header row from lg, menu below lg): neither shows.
      expect(page.getByRole('link', { name: 'Paint' }).elements()).toEqual([]);
      expect(page.getByText('Paint').elements()).toHaveLength(2);

      await menu().click();
      await expect.element(menu()).toHaveAttribute('aria-expanded', 'true');
      const panel = document.getElementById(menu().element().getAttribute('aria-controls')!);
      expect(panel).not.toBeNull();
      await expect.element(page.getByRole('button', { name: 'Another future' })).toBeVisible();
      await expect.element(page.getByRole('link', { name: 'Paint' })).toBeVisible();
      await expect.element(page.getByRole('link', { name: 'Simulate' })).toBeVisible();
      await expect.element(banner.getByRole('button', { name: '1,234 homes added' })).toBeVisible();
      const el = banner.element() as HTMLElement;
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
      expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth);
    });

    it('at 375px keeps the order name, status, pinned, Menu', async () => {
      await page.viewport(375, 812);
      const st = createRawSnippet(() => ({ render: () => '<span data-testid="st">saved</span>' }));
      render(SiteHeader, { routeId: '/sim', actions, pinned, status: st });
      const x = (el: Element) => el.getBoundingClientRect().left;
      const name = page.getByRole('link', { name: /SF Housing/ }).element();
      const status = page.getByTestId('st').element();
      const score = page.getByRole('button', { name: '1,234 homes added' }).element();
      const m = menu().element();
      expect(x(name)).toBeLessThan(x(status));
      expect(x(status)).toBeLessThan(x(score));
      expect(x(score)).toBeLessThan(x(m));
    });

    it('centres the score at 1024px even with a long status', async () => {
      await page.viewport(1024, 768);
      const long = createRawSnippet(() => ({
        render: () => `<span>${'Saved a very long time ago '.repeat(12)}</span>`
      }));
      render(SiteHeader, { routeId: '/sim', actions, pinned, status: long });
      const r = page
        .getByRole('button', { name: '1,234 homes added' })
        .element()
        .getBoundingClientRect();
      const h = page.getByRole('banner').element().getBoundingClientRect();
      expect(Math.abs((r.left + r.right) / 2 - (h.left + h.right) / 2)).toBeLessThan(1);
    });

    it('Escape closes the menu and returns focus to Menu', async () => {
      await page.viewport(375, 812);
      render(SiteHeader, { routeId: '/sim', actions, pinned });
      await menu().click();
      (page.getByRole('link', { name: 'Paint' }).element() as HTMLElement).focus();
      await userEvent.keyboard('{Escape}');
      await expect.element(menu()).toHaveAttribute('aria-expanded', 'false');
      await expect.element(menu()).toHaveFocus();
      await expect.element(page.getByText('Another future')).not.toBeVisible();
    });

    it('choosing a plain button closes the menu; a disclosure inside keeps it open', async () => {
      await page.viewport(375, 812);
      render(SiteHeader, { routeId: '/sim', actions, pinned });
      await menu().click();
      await page.getByRole('button', { name: 'View' }).click();
      await expect.element(menu()).toHaveAttribute('aria-expanded', 'true');
      await page.getByRole('button', { name: 'Another future' }).click();
      await expect.element(menu()).toHaveAttribute('aria-expanded', 'false');
      await expect.element(page.getByText('Another future')).not.toBeVisible();
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

      it('from lg it sits right after the last mode link, left of the actions', async () => {
        await page.viewport(1024, 768);
        render(SiteHeader, { routeId: '/sim', actions, pinned, status });
        const slot = page.getByTestId('status-slot').element();
        const nav = page.getByRole('navigation', { name: 'Modes' });
        const lastLink = nav.getByRole('link', { name: 'Fewer cars' }).element();
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
          `<button class="${btn} bg-accent text-on-accent">Share link</button>` +
          `<button class="${btn}">Another future</button></div>`
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
              page.getByRole('navigation', { name: 'Modes' }).element(),
              chip.element(),
              page.getByRole('button', { name: '12,345 homes added' }).element(),
              page.getByRole('button', { name: 'View' }).element(),
              page.getByRole('button', { name: 'Policy' }).element(),
              page.getByRole('button', { name: 'Share link' }).element(),
              page.getByRole('button', { name: 'Another future' }).element()
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
            for (const name of ['View', 'Policy', 'Share link', 'Another future'])
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

      it('at 375px it sits right after the site title, outside the Menu', async () => {
        await page.viewport(375, 812);
        render(HeaderScoreHeader, { props: { actions, status, total: 12345, delta: 12345 } });
        const host = page.getByTestId('status-slot').element() as HTMLElement;
        const a = mount(SaveIndicator, { target: host, props: { status: 'off', align: 'start' } });
        try {
          const chip = page.getByRole('button', { name: 'Autosave off' });
          await expect.element(chip).toBeVisible();
          const title = page.getByRole('link', { name: /SF Housing/ }).element();
          const c = chip.element().getBoundingClientRect();
          expect(c.left).toBeGreaterThanOrEqual(title.getBoundingClientRect().right);
          expect(c.left - title.getBoundingClientRect().right).toBeLessThanOrEqual(24);
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
      await expect.element(page.getByRole('button', { name: 'Another future' })).toBeVisible();
      expect(page.getByRole('button', { name: 'Menu' }).elements()).toEqual([]);
      const score = page.getByRole('button', { name: '1,234 homes added' }).element();
      const other = page.getByRole('button', { name: 'Another future' }).element();
      expect(score.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(score.getBoundingClientRect().right).toBeLessThanOrEqual(
        other.getBoundingClientRect().left
      );
    });

    it('centres the pinned item in the header from lg', async () => {
      await page.viewport(1024, 768);
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
