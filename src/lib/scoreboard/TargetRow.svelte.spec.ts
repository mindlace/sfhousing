/// <reference types="@vitest/browser-playwright" />
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { cdp, page } from 'vitest/browser';
import '../../routes/layout.css';
import TargetRow from './TargetRow.svelte';

const tp = {
  target: {
    id: 'rhna',
    label: 'RHNA',
    units: 1000,
    source: { label: 'ABAG', url: 'https://example.org' }
  },
  fraction: 0.4
};

async function scheme(value: 'light' | 'dark') {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value }]
  });
}
const bg = (testid: string) => getComputedStyle(page.getByTestId(testid).element()).backgroundColor;
const track = () => getComputedStyle(page.getByRole('meter').element()).backgroundColor;
const body = () =>
  getComputedStyle(page.getByTestId('target-rhna').element().querySelector('p')!).color;
const target = () => getComputedStyle(page.getByText('target', { exact: true }).element()).color;
const parts = () => [track(), bg('bar-fill'), bg('bar-tick'), body(), target()];

afterEach(async () => {
  await scheme('light');
});

describe('TargetRow themes', () => {
  it('track, fill, tick and text all change with the scheme (it always follows the tokens)', async () => {
    await page.viewport(1024, 768);
    await render(TargetRow, { props: { tp, net: 400, max: 1, primary: true } });
    await scheme('light');
    const light = parts();
    await scheme('dark');
    await expect.poll(parts).not.toEqual(light);
    const dark = parts();
    light.forEach((v, k) => expect(dark[k], `part ${k}`).not.toBe(v));
  });
});
