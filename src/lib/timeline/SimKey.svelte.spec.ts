/// <reference types="@vitest/browser-playwright" />
// /sim's key panel: the tally of homes by stage at the playhead's month. The legend cases that
// lived in SimResults (one row per entry with its swatch, every token resolving in both themes)
// moved here with the key.
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { cdp, page, userEvent } from 'vitest/browser';
import axe from 'axe-core';
import '../../routes/layout.css';
import { timelineTokenCss } from '$lib/map/palette';
import { STAGE_KEY } from '$lib/map/key/rows';
import { KEY_COPY } from '$lib/map/key/copy';
import { HALO_KIND, HALO_TOKEN } from '$lib/map/timelapse/halos';
import { CITY_KIND_TOKEN } from '$lib/map/timelapse/city';
import { longTexts } from '$lib/shell/test/rest-text';
import SimKey, { AREA_SWATCH, EDGE_SWATCH } from './SimKey.svelte';
import SimKeyControlHost from './test/SimKeyControlHost.svelte';
import type { KeyTally } from './key';

const TALLY: KeyTally = {
  planning: 1200,
  approved: 34,
  issued: 5,
  building: 678,
  completed: 9100,
  stopped: 2
};

async function scheme(value: 'light' | 'dark') {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value }]
  });
}

/** The key's tokens live on `.sfh-map-key` (MapKeyControl's root); here a plain wrapper. */
function withTokens(): HTMLElement {
  const style = document.createElement('style');
  style.textContent = timelineTokenCss('.sfh-map-key');
  document.head.appendChild(style);
  const box = document.createElement('div');
  box.className = 'sfh-map-key';
  document.body.appendChild(box);
  return box;
}

afterEach(async () => {
  await scheme('light');
  document.querySelectorAll('.sfh-map-key').forEach((e) => e.remove());
});

describe('SimKey', () => {
  it('lists the six groups, each label beside its count, under Homes', async () => {
    await render(SimKey, { props: { tally: TALLY, inForce: false } });
    await expect.element(page.getByText('Homes', { exact: true })).toBeVisible();
    const dl = document.querySelector('dl')!;
    expect(dl.getAttribute('aria-labelledby')).toBe(page.getByText('Homes').element().id);
    const rows = [...dl.querySelectorAll('[data-key-row]')];
    expect(
      rows.map((r) => [r.querySelector('dt')!.textContent, r.querySelector('dd')!.textContent])
    ).toEqual([
      ['Planning review', '1,200'],
      ['Approved', '34'],
      ['Permit issued', '5'],
      ['Building', '678'],
      ['Completed', '9,100'],
      ['Stopped', '2']
    ]);
    expect((await axe.run(dl.parentElement!)).violations).toEqual([]);
  });

  it("shows '…' for every count while the tally is null", async () => {
    await render(SimKey, { props: { tally: null, inForce: false } });
    const counts = [...document.querySelectorAll('dl dd')].map((d) => d.textContent);
    expect(counts).toEqual(['…', '…', '…', '…', '…', '…']);
  });

  it('has one row per STAGE_KEY entry with its swatch tokens (replaces SimResults legend rows)', async () => {
    await render(SimKey, { props: { tally: TALLY, inForce: false } });
    const rows = [...document.querySelectorAll('[data-key-row]')];
    expect(rows.map((r) => r.getAttribute('data-key-row'))).toEqual(STAGE_KEY.map((e) => e.id));
    for (const e of STAGE_KEY) {
      const row = document.querySelector(`[data-key-row="${e.id}"]`)!;
      const sw = row.querySelector('[data-swatch]')!;
      expect(sw.getAttribute('aria-hidden')).toBe('true');
      expect(sw.getAttribute('data-swatch')).toBe(e.swatch.kind);
      const tokens = [...sw.querySelectorAll('[data-token]')].flatMap((t) =>
        t.getAttribute('data-token')!.split(' ')
      );
      expect(tokens).toEqual(e.swatch.tokens);
    }
  });

  it('resolves every swatch token under light and dark (replaces SimResults)', async () => {
    const box = withTokens();
    await render(SimKey, { props: { tally: TALLY, inForce: false }, target: box });
    const read = (id: string, token: string) =>
      getComputedStyle(document.querySelector(`[data-key-row="${id}"] [data-swatch]`)!)
        .getPropertyValue(`--map-${token}`)
        .trim();
    const tokens = STAGE_KEY.flatMap((e) => e.swatch.tokens.map((t) => [e.id, t] as const));
    expect(tokens.length).toBeGreaterThan(10);

    await scheme('light');
    const light = tokens.map(([id, t]) => read(id, t));
    await scheme('dark');
    await expect.poll(() => tokens.map(([id, t]) => read(id, t))).not.toEqual(light);
    const dark = tokens.map(([id, t]) => read(id, t));
    tokens.forEach(([, t], k) => {
      expect(light[k], `${t} light`).not.toBe('');
      expect(dark[k], `${t} dark`).not.toBe('');
      expect(dark[k], `${t} differs by theme`).not.toBe(light[k]);
    });
  });
  /** The rows after the tally: [kind, its first swatch's kind, its tokens, its words]. */
  const extras = () =>
    [...document.querySelectorAll('[data-key-extra]')].map((r) => {
      const sw = r.querySelector('[data-swatch]')!;
      return [
        r.getAttribute('data-key-extra'),
        sw.getAttribute('data-swatch'),
        [...r.querySelectorAll('[data-token]')].flatMap((t) =>
          t.getAttribute('data-token')!.split(' ')
        ),
        r.textContent!.replace(/\s+/g, ' ').trim()
      ];
    });

  it('names the ring, and the bar, always', async () => {
    await render(SimKey, { props: { tally: TALLY, inForce: false } });
    const tones = ['tl-halo-approved', 'tl-halo-started', 'tl-halo-complete'];
    const city = [...tones, 'tl-halo-policy'];
    expect(extras()).toEqual([
      [
        'ring',
        'ring',
        [...tones, ...city, ...city],
        `${KEY_COPY.ring} Approved Building Completed ${KEY_COPY.area} ${KEY_COPY.edge}`
      ],
      ['area', 'area', city, KEY_COPY.area],
      ['edge', 'edge', city, KEY_COPY.edge],
      ['bar', 'bar', ['tl-bar-unlikely', 'tl-bar-uncertain', 'tl-bar-likely'], KEY_COPY.bar]
    ]);
    // A list after the tally, its swatches beside words and hidden from assistive tech.
    const list = document.querySelector('dl + ul')!;
    expect(list.querySelectorAll(':scope > li')).toHaveLength(2);
    for (const sw of list.querySelectorAll('[data-swatch]'))
      expect(sw.getAttribute('aria-hidden')).toBe('true');
    expect(document.body.textContent).not.toContain(KEY_COPY.mark);
    expect((await axe.run(list.parentElement!)).violations).toEqual([]);
  });

  it("names each ring's tone beside its stage word, with the token the halo layer draws it in", async () => {
    await render(SimKey, { props: { tally: TALLY, inForce: false } });
    const ring = document.querySelector('[data-key-extra="ring"]')!;
    // The heading, then one ring per kind the layer draws (every HALO_KIND but the mark).
    expect(ring.firstElementChild!.textContent).toBe(KEY_COPY.ring);
    const kinds = Object.keys(HALO_KIND).filter((k) => k !== 'mark');
    const rows = [...ring.querySelectorAll('[data-ring-kind]')].map((r) => [
      r.getAttribute('data-ring-kind'),
      r.querySelector('[data-swatch="ring"]')!.getAttribute('aria-hidden'),
      [...r.querySelectorAll('[data-token]')].map((t) => t.getAttribute('data-token')),
      r.textContent!.trim()
    ]);
    const word = (id: string) => STAGE_KEY.find((g) => g.id === id)!.label;
    expect(rows).toEqual([
      ['approved', 'true', [HALO_TOKEN.approved], word('approved')],
      ['started', 'true', [HALO_TOKEN.started], word('building')],
      ['completed', 'true', [HALO_TOKEN.completed], word('completed')]
    ]);
    expect(rows.map(([k]) => k)).toEqual(kinds);
  });

  it('names the merged ring and the edge glow under "Just changed stage", in the tones the city layer draws', async () => {
    expect(KEY_COPY.area).toBe('Zoomed out: one per area');
    expect(KEY_COPY.edge).toBe('Edge glow: off screen');
    // CITY_KIND_TOKEN: the three halo tones and the policy accent.
    const tones = [HALO_TOKEN.approved, HALO_TOKEN.started, HALO_TOKEN.completed, 'tl-halo-policy'];
    expect(tones).toEqual(CITY_KIND_TOKEN);
    expect(AREA_SWATCH).toEqual({ kind: 'area', tokens: tones });
    expect(EDGE_SWATCH).toEqual({ kind: 'edge', tokens: tones });
    // In the panel's width, where each row must sit on one line.
    await page.viewport(1280, 800);
    const box = withTokens();
    box.style.width = '240px';
    box.style.padding = '8px';
    box.style.fontSize = '0.875rem';
    box.style.lineHeight = '1.25rem';
    await render(SimKey, { props: { tally: TALLY, inForce: false }, target: box });
    const ring = box.querySelector('[data-key-extra="ring"]')!;
    // After the three tone rows, in the same list.
    expect(
      [...ring.querySelector('ul')!.children].map(
        (li) => li.getAttribute('data-ring-kind') ?? li.getAttribute('data-key-extra')
      )
    ).toEqual(['approved', 'started', 'completed', 'area', 'edge']);
    const rows = [...ring.querySelectorAll('[data-key-extra]')].map((r) => {
      const sw = r.querySelector('[data-swatch]')!;
      return [
        r.getAttribute('data-key-extra'),
        sw.getAttribute('data-swatch'),
        sw.getAttribute('aria-hidden'),
        [...sw.querySelectorAll('[data-token]')].map((t) => t.getAttribute('data-token')),
        r.textContent!.trim()
      ];
    });
    expect(rows).toEqual([
      ['area', 'area', 'true', tones, KEY_COPY.area],
      ['edge', 'edge', 'true', tones, KEY_COPY.edge]
    ]);
    // Each on one line, its swatch inside its row; every tone drawn (a visible box).
    for (const kind of ['area', 'edge']) {
      const row = ring.querySelector(`[data-key-extra="${kind}"]`)!;
      const words = row.querySelector('span:not([data-swatch]):not([data-swatch] *)')!;
      expect(words.getClientRects(), `${kind} on one line`).toHaveLength(1);
      expect(row.getBoundingClientRect().height, `${kind} row height`).toBeLessThanOrEqual(20);
      for (const t of row.querySelectorAll('[data-token]')) {
        const r = t.getBoundingClientRect();
        expect(r.width * r.height, `${kind} tone drawn`).toBeGreaterThan(0);
        const cs = getComputedStyle(t);
        expect(cs.borderTopColor + cs.backgroundColor, `${kind} tone colour`).not.toBe(
          'rgba(0, 0, 0, 0)rgba(0, 0, 0, 0)'
        );
      }
    }
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth);
    expect((await axe.run(ring)).violations).toEqual([]);
  });

  it('names the mark with its explanation only while a policy is in force', async () => {
    const r = await render(SimKey, { props: { tally: TALLY, inForce: true } });
    expect(extras().map(([k]) => k)).toEqual(['ring', 'area', 'edge', 'mark', 'bar']);
    const mark = document.querySelector('[data-key-extra="mark"]')!;
    expect(mark.querySelector('[data-swatch]')!.getAttribute('data-swatch')).toBe('mark');
    expect(
      [...mark.querySelectorAll('[data-token]')].flatMap((t) =>
        t.getAttribute('data-token')!.split(' ')
      )
    ).toEqual(['tl-halo-policy']);
    const button = page.getByRole('button', { name: KEY_COPY.mark });
    await expect.element(button).toBeVisible();
    // The claim is behind the tap, never at rest.
    expect(document.body.textContent).not.toContain(KEY_COPY.markWhy);
    expect(document.body.textContent).not.toMatch(/because/i);
    expect(longTexts()).toEqual([]);
    expect((await axe.run(document.querySelector('ul')!.parentElement!)).violations).toEqual([]);
    await r.rerender({ tally: TALLY, inForce: false });
    await expect.element(button).not.toBeInTheDocument();
    expect(extras().map(([k]) => k)).toEqual(['ring', 'area', 'edge', 'bar']);
  });

  it("the mark's explanation opens on focus and on tap, and is under 12 words", async () => {
    await render(SimKey, { props: { tally: TALLY, inForce: true } });
    const button = page.getByRole('button', { name: KEY_COPY.mark });
    const el = button.element() as HTMLElement;
    el.focus();
    const tip = page.getByRole('tooltip');
    await expect.element(tip).toHaveTextContent(KEY_COPY.markWhy);
    await expect.element(button).toHaveAccessibleDescription(KEY_COPY.markWhy);
    expect(KEY_COPY.markWhy.split(/\s+/).length).toBeLessThan(12);
    el.blur();
    await expect.element(tip).not.toBeInTheDocument();
    const tap = () => {
      el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
      el.focus();
      el.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }));
    };
    tap();
    await expect.element(tip).toHaveTextContent(KEY_COPY.markWhy);
    tap();
    await expect.element(tip).not.toBeInTheDocument();
  });

  it("the mark's button is at least 24 px tall, and its open text stays inside the panel's width", async () => {
    // From md, where Explain is otherwise a popover beside its target.
    await page.viewport(1280, 800);
    const box = withTokens();
    box.style.width = '240px';
    box.style.overflowY = 'auto';
    await render(SimKey, { props: { tally: TALLY, inForce: true }, target: box });
    const el = page.getByRole('button', { name: KEY_COPY.mark }).element() as HTMLElement;
    expect(el.getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
    el.focus();
    await expect.element(page.getByRole('tooltip')).toBeVisible();
    // No sideways scroll inside the key's panel (which scrolls on y only).
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth);
  });

  it('resolves every token the ring, mark and bar rows use, and every bar tone, light and dark', async () => {
    const box = withTokens();
    await render(SimKey, { props: { tally: TALLY, inForce: true }, target: box });
    const used = [...box.querySelectorAll('[data-key-extra] [data-token]')].flatMap((t) =>
      t.getAttribute('data-token')!.split(' ')
    );
    // The bar tones the map draws, the dead one and the edge included (no other DOM test reads them).
    const tokens = [...new Set([...used, 'tl-bar-dead', 'tl-bar-edge'])];
    expect(tokens).toEqual(
      expect.arrayContaining([
        'tl-halo-approved',
        'tl-halo-started',
        'tl-halo-complete',
        'tl-halo-policy',
        'tl-bar-unlikely',
        'tl-bar-uncertain',
        'tl-bar-likely',
        'tl-bar-dead',
        'tl-bar-edge'
      ])
    );
    const sw = box.querySelector('[data-key-extra="bar"] [data-swatch]')!;
    const read = (t: string) => getComputedStyle(sw).getPropertyValue(`--map-${t}`).trim();
    await scheme('light');
    const light = tokens.map(read);
    await scheme('dark');
    await expect.poll(() => tokens.map(read)).not.toEqual(light);
    const dark = tokens.map(read);
    tokens.forEach((t, k) => {
      expect(light[k], `${t} light`).not.toBe('');
      expect(dark[k], `${t} dark`).not.toBe('');
      expect(dark[k], `${t} differs by theme`).not.toBe(light[k]);
    });
  });
  it("in the key's panel, Escape closes the mark's explanation first, then the panel", async () => {
    await page.viewport(1280, 800);
    await render(SimKeyControlHost, { props: { tally: TALLY, inForce: true } });
    const panel = page.getByRole('group', { name: 'Map key' });
    const toggle = page.getByRole('button', { name: 'Map key' });
    const button = page.getByRole('button', { name: KEY_COPY.mark });
    await expect.element(panel).toBeVisible();
    (button.element() as HTMLElement).focus();
    const tip = page.getByRole('tooltip');
    await expect.element(tip).toBeVisible();
    // First Escape: only the explanation closes; the panel stays, focus stays on the button.
    await userEvent.keyboard('{Escape}');
    await expect.element(tip).not.toBeInTheDocument();
    await expect.element(panel).toBeVisible();
    await expect.element(button).toHaveFocus();
    await expect.element(toggle).toHaveAttribute('aria-expanded', 'true');
    // Second Escape: the panel closes and focus goes to its toggle.
    await userEvent.keyboard('{Escape}');
    await expect.element(panel).not.toBeInTheDocument();
    await expect.element(toggle).toHaveFocus();
    await expect.element(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});
