// /fzp is no longer a page (plan 3, Call 14): its load redirects to /sim with a 307, every query
// parameter kept except the retired `start`.
import { isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { load } from './+page';

type LoadEvent = Parameters<typeof load>[0];

async function redirectOf(search: string): Promise<{ status: number; location: string }> {
  const event = { url: new URL(`http://localhost/fzp${search}`) } as unknown as LoadEvent;
  try {
    await load(event);
  } catch (e) {
    if (isRedirect(e)) return { status: e.status, location: e.location };
    throw e;
  }
  throw new Error('the /fzp load did not redirect');
}

describe('/fzp load', () => {
  it('throws a 307 to /sim with the query kept', async () => {
    expect(await redirectOf('?seed=5&x=1')).toEqual({
      status: 307,
      location: '/sim?seed=5&x=1'
    });
  });

  it('redirects to /sim keeping every parameter but start', async () => {
    expect(await redirectOf('?seed=5&start=fzp&a=1')).toEqual({
      status: 307,
      location: '/sim?seed=5&a=1'
    });
    expect((await redirectOf('?seed=abc&x=1&x=2')).location).toBe('/sim?seed=abc&x=1&x=2');
  });

  it('redirects a bare /fzp to /sim', async () => {
    expect(await redirectOf('')).toEqual({ status: 307, location: '/sim' });
  });
});
