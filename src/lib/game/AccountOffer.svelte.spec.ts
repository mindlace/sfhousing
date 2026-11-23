import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import AccountOffer from './AccountOffer.svelte';

it('AccountOffer renders nothing', async () => {
  const view = await render(AccountOffer);
  expect(view.container.children.length).toBe(0);
  expect(view.container.textContent).toBe('');
});
