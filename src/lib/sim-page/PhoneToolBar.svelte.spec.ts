/// <reference types="@vitest/browser-playwright" />
// The phone floating tool bar (layout ruling 5): tool, stories and radius pop-overs, Done.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import { BrushState } from '$lib/brush/state.svelte';
import { SimBrushTools, type SimTool } from './brush-tools.svelte';
import PhoneToolBar from './PhoneToolBar.svelte';

function setup(tool: SimTool = 'paint') {
  const brush = new BrushState({ storage: null, fine: false });
  brush.phase = 'ready';
  const tools = new SimBrushTools(brush);
  tools.tool = tool;
  const ontool = vi.fn((t: SimTool) => (tools.tool = t));
  const ondone = vi.fn();
  render(PhoneToolBar, { props: { tools, ontool, ondone } });
  return { tools, ontool, ondone };
}

describe('PhoneToolBar at 375 px', () => {
  beforeEach(async () => {
    await page.viewport(375, 700);
  });

  it('opens the stories and radius pop-overs', async () => {
    setup();
    await expect.element(page.getByRole('group', { name: 'Brush' })).toHaveTextContent('Paint');
    const stories = page.getByRole('button', { name: '6 stories per stroke' });
    await expect.element(stories).toHaveAttribute('aria-expanded', 'false');
    await stories.click();
    await expect.element(stories).toHaveAttribute('aria-expanded', 'true');
    await expect.element(page.getByRole('spinbutton', { name: 'Stories' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await expect.element(stories).toHaveAttribute('aria-expanded', 'false');

    const radius = page.getByRole('button', { name: 'Brush 30 m' });
    await radius.click();
    await expect.element(radius).toHaveAttribute('aria-expanded', 'true');
    await expect
      .element(page.getByRole('slider', { name: 'Brush 30 m', exact: true }))
      .toBeVisible();
    // Opening one closes the other.
    await stories.click();
    await expect.element(radius).toHaveAttribute('aria-expanded', 'false');
    await expect.element(stories).toHaveAttribute('aria-expanded', 'true');
  });

  it('has no Mode or Density, and no Stories while protecting', async () => {
    setup('protect');
    await expect.element(page.getByRole('group', { name: 'Brush' })).toHaveTextContent('Protect');
    await expect.element(page.getByRole('button', { name: 'Brush 30 m' })).toBeVisible();
    expect(page.getByRole('button', { name: /stories per stroke/ }).elements()).toHaveLength(0);
    expect(page.getByRole('checkbox').elements()).toHaveLength(0);
    expect(page.getByRole('radiogroup', { name: 'Mode' }).elements()).toHaveLength(0);
  });

  it('Done selects Move', async () => {
    const { ontool, ondone, tools } = setup();
    await page.getByRole('button', { name: 'Done' }).click();
    expect(ontool).toHaveBeenCalledWith('move');
    expect(tools.tool).toBe('move');
    expect(ondone).toHaveBeenCalledOnce();
  });

  it('keeps every control at least 24 px and fits 375 px', async () => {
    setup();
    const bar = page.getByRole('group', { name: 'Brush' }).element() as HTMLElement;
    await expect.element(page.getByRole('button', { name: 'Done' })).toBeVisible();
    for (const el of bar.querySelectorAll<HTMLElement>('button')) {
      const r = el.getBoundingClientRect();
      expect(r.width).toBeGreaterThanOrEqual(24);
      expect(r.height).toBeGreaterThanOrEqual(24);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
  });
});
