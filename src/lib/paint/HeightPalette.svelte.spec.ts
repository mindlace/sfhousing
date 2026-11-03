/// <reference types="@vitest/browser-playwright" />
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { STORY_PRESETS } from '$lib/brush/radius';
import { BrushState } from '$lib/brush/state.svelte';
import HeightPalette from './HeightPalette.svelte';

const setup = (props: { disabled?: boolean; hint?: string } = {}) => {
  const brush = new BrushState({ fine: true, storage: null });
  brush.setStories(6);
  render(HeightPalette, { props: { brush, ...props } });
  return brush;
};
const swatch = (n: number) => page.getByRole('button', { name: `${n} stories`, exact: true });

describe('HeightPalette', () => {
  it('is a Height group with one swatch per preset', async () => {
    setup();
    await expect.element(page.getByRole('group', { name: 'Height' })).toBeVisible();
    for (const n of STORY_PRESETS) await expect.element(swatch(n)).toBeVisible();
  });

  it('pressing a swatch sets the height and only that swatch is pressed', async () => {
    const brush = setup();
    await swatch(12).click();
    expect(brush.stories).toBe(12);
    await expect.element(swatch(12)).toHaveAttribute('aria-pressed', 'true');
    for (const n of STORY_PRESETS.filter((n) => n !== 12)) {
      await expect.element(swatch(n)).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('steps one story at a time and presses no swatch off the presets', async () => {
    const brush = setup();
    await swatch(12).click();
    await page.getByRole('button', { name: 'More stories' }).click();
    expect(brush.stories).toBe(13);
    await expect.element(page.getByRole('spinbutton', { name: 'Stories' })).toHaveValue(13);
    for (const n of STORY_PRESETS) {
      await expect.element(swatch(n)).toHaveAttribute('aria-pressed', 'false');
    }
    await page.getByRole('button', { name: 'Fewer stories' }).click();
    expect(brush.stories).toBe(12);
    await expect.element(page.getByText('≈ 37 m')).toBeVisible();
  });

  it('commits a typed height', async () => {
    const brush = setup();
    const input = page.getByRole('spinbutton', { name: 'Stories' });
    await input.fill('20');
    input.element().blur();
    expect(brush.stories).toBe(20);
  });

  it('disables every control and describes them by the hint', async () => {
    setup({ disabled: true, hint: 'Erase has no height' });
    await expect.element(page.getByText('Erase has no height')).toBeVisible();
    for (const n of STORY_PRESETS) await expect.element(swatch(n)).toBeDisabled();
    await expect.element(page.getByRole('button', { name: 'Fewer stories' })).toBeDisabled();
    await expect.element(page.getByRole('button', { name: 'More stories' })).toBeDisabled();
    await expect.element(page.getByRole('spinbutton', { name: 'Stories' })).toBeDisabled();
    await expect
      .element(page.getByRole('group', { name: 'Height' }))
      .toHaveAccessibleDescription('Erase has no height');
  });
});
