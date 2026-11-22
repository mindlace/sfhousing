import { isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { load } from './+page.server';

describe('/attribution load', () => {
  it('redirects 308 to /about#about-data', async () => {
    let thrown: unknown;
    try {
      await load({} as never);
    } catch (e) {
      thrown = e;
    }
    expect(isRedirect(thrown)).toBe(true);
    expect(thrown).toMatchObject({ status: 308, location: '/about#about-data' });
  });
});
