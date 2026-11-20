/// <reference types="@vitest/browser-playwright" />
// /sim's key panel: the tally of homes by stage at the playhead's month. The legend cases that
// lived in SimResults (one row per entry with its swatch, every token resolving in both themes)
// moved here with the key.
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { cdp, page } from 'vitest/browser';
import axe from 'axe-core';
import '../../routes/layout.css';
import { timelineTokenCss } from '$lib/map/palette';
import { STAGE_KEY } from '$lib/map/key/rows';
import SimKey from './SimKey.svelte';
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
    await render(SimKey, { props: { tally: TALLY } });
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
    await render(SimKey, { props: { tally: null } });
    const counts = [...document.querySelectorAll('dl dd')].map((d) => d.textContent);
    expect(counts).toEqual(['…', '…', '…', '…', '…', '…']);
  });

  it('has one row per STAGE_KEY entry with its swatch tokens (replaces SimResults legend rows)', async () => {
    await render(SimKey, { props: { tally: TALLY } });
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
    await render(SimKey, { props: { tally: TALLY }, target: box });
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
});
