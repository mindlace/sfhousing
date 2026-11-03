import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import NoticePillsHost from './test/NoticePillsHost.svelte';

describe('NoticePills', () => {
  const stack = () => page.getByTestId('fzp-notices');

  it('renders its children in the notice stack', async () => {
    render(NoticePillsHost);
    await expect.element(stack()).toBeInTheDocument();
    await expect.element(stack().getByText('First notice')).toBeVisible();
    await expect.element(stack().getByText('Second notice')).toBeVisible();
    await expect.element(stack().getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  it('overlays the map from md, letting clicks through except on the pills', async () => {
    await page.viewport(1024, 768);
    render(NoticePillsHost);
    await expect.element(stack()).toBeInTheDocument();
    expect(getComputedStyle(stack().element()).position).toBe('absolute');
    expect(getComputedStyle(stack().element()).pointerEvents).toBe('none');
    expect(getComputedStyle(stack().getByText('First notice').element()).pointerEvents).toBe(
      'auto'
    );
  });

  it('sits in flow and full width below md', async () => {
    await page.viewport(375, 812);
    render(NoticePillsHost);
    await expect.element(stack()).toBeInTheDocument();
    expect(getComputedStyle(stack().element()).position).toBe('static');
    expect(stack().element().getBoundingClientRect().width).toBe(375);
  });

  // Map-view's failure chips sit at the map's top centre too: from md they go below the stack.
  const hostEl = () => page.getByTestId('pills-host').element();
  const published = () => getComputedStyle(hostEl()).getPropertyValue('--notice-pills-bottom');

  it("from md publishes the stack's bottom edge on its host as --notice-pills-bottom", async () => {
    await page.viewport(1024, 768);
    render(NoticePillsHost);
    await expect.element(stack().getByText('Second notice')).toBeVisible();
    const host = hostEl().getBoundingClientRect();
    const s = stack().element().getBoundingClientRect();
    await expect.poll(published).toBe(`${Math.round(s.bottom - host.top)}px`);
  });

  it('publishes 0px when empty, and below md (in flow, the map is already below it)', async () => {
    await page.viewport(1024, 768);
    const screen = await render(NoticePillsHost, { empty: true });
    await expect.element(stack()).toBeInTheDocument();
    await expect.poll(published).toBe('0px');
    await screen.unmount();
    await page.viewport(375, 812);
    render(NoticePillsHost);
    await expect.element(stack().getByText('First notice')).toBeVisible();
    await expect.poll(published).toBe('0px');
  });
});
