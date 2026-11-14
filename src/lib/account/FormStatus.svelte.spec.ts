import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { flushSync } from 'svelte';
import FormStatus from './FormStatus.svelte';

describe('FormStatus', () => {
  it('is a persistent polite status node: same element before and after a message', async () => {
    expect.hasAssertions();
    const props = $state({ message: '' });
    const { container } = await render(FormStatus, props);
    const node = container.querySelector('[data-testid="form-status"]')!;
    expect(node.getAttribute('role')).toBe('status');
    expect(node.getAttribute('aria-live')).toBe('polite');
    props.message = 'sent!';
    flushSync();
    expect(container.querySelector('[data-testid="form-status"]')).toBe(node);
    expect(node.textContent).toBe('sent!');
    expect(document.activeElement).not.toBe(node); // focus=false default
  });

  it('takes focus when focus=true and a message arrives', async () => {
    expect.hasAssertions();
    const props = $state({ message: '', focus: true });
    const { container } = await render(FormStatus, props);
    const node = container.querySelector('[data-testid="form-status"]') as HTMLElement;
    props.message = 'check your email';
    flushSync();
    await expect.poll(() => document.activeElement).toBe(node);
  });
});
