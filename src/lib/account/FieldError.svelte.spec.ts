import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import FieldError from './FieldError.svelte';

describe('FieldError', () => {
  it('renders the message under the given id and focuses the associated field on mount', async () => {
    expect.hasAssertions();
    const input = document.createElement('input');
    input.id = 'ident';
    document.body.appendChild(input);
    const { container } = await render(FieldError, {
      id: 'ident-error',
      forId: 'ident',
      message: 'nope'
    });
    const p = container.querySelector('#ident-error')!;
    expect(p.textContent).toBe('nope');
    expect(p.getAttribute('data-testid')).toBe('ident-error');
    await expect.poll(() => document.activeElement).toBe(input);
    input.remove();
  });

  it('renders nothing for a null message', async () => {
    expect.hasAssertions();
    const { container } = await render(FieldError, { id: 'x-error', forId: 'x', message: null });
    expect(container.querySelector('#x-error')).toBeNull();
  });
});
