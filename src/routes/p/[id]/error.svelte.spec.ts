import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ErrorPage from './+error.svelte';

const state = vi.hoisted(() => ({
  page: { status: 404, error: null as { message: string } | null }
}));
vi.mock('$app/state', () => state);

describe('/p/[id] error page', () => {
  it('a 404 titles "Plan not found · SF Housing"', async () => {
    state.page.status = 404;
    state.page.error = null;
    render(ErrorPage);
    await expect.poll(() => document.title).toBe('Plan not found · SF Housing');
  });

  it('any other failure titles "Something went wrong · SF Housing"', async () => {
    state.page.status = 500;
    state.page.error = { message: 'boom' };
    render(ErrorPage);
    await expect.poll(() => document.title).toBe('Something went wrong · SF Housing');
  });
});
