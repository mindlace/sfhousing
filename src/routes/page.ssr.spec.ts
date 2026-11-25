import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
import { homeData } from './test/home-data';

describe('/ on the server', () => {
  it('on the server: the heading SF Housing and an empty home-frame; no brush, no simulation', () => {
    const { body, head } = render(Page, { props: { data: homeData(), params: {} } });
    expect(head).toContain('<title>SF Housing</title>');
    expect(body).toMatch(/<h1 class="sr-only">SF Housing<\/h1>/);
    const frame = /data-testid="home-frame"[^>]*>([\s\S]*?)<\/div>/.exec(body);
    expect(frame?.[1].replace(/<!--[\s\S]*?-->/g, '')).toBe('');
    expect(body).not.toContain('role="radiogroup"');
    expect(body).not.toContain('data-phase');
  });
});
