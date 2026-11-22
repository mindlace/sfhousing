import { describe, expect, it } from 'vitest';
import { aboutTarget } from './links';

const ORIGIN = 'https://sfhousing.example';

/** What aboutTarget reads of an anchor: its resolved href, its target and a download attribute. */
const link = (href: string, over: { target?: string; download?: boolean } = {}) =>
  ({
    href: new URL(href, ORIGIN).href,
    target: over.target ?? '',
    hasAttribute: (name: string) => name === 'download' && !!over.download
  }) as unknown as HTMLAnchorElement;

describe('aboutTarget', () => {
  it('aboutTarget: /about → "", /about#about-data → "about-data", /about#src-x → "src-x"', () => {
    expect(aboutTarget(link('/about'), ORIGIN)).toBe('');
    expect(aboutTarget(link('/about#about-data'), ORIGIN)).toBe('about-data');
    expect(aboutTarget(link('/about#src-x'), ORIGIN)).toBe('src-x');
    expect(aboutTarget(link(`${ORIGIN}/about#about-assumptions`), ORIGIN)).toBe(
      'about-assumptions'
    );
    expect(aboutTarget(link('/about', { target: '_self' }), ORIGIN)).toBe('');
  });

  it('aboutTarget: another path, another origin, a target="_blank" or a download link → null', () => {
    expect(aboutTarget(link('/sim'), ORIGIN)).toBeNull();
    expect(aboutTarget(link('/about/more'), ORIGIN)).toBeNull();
    expect(aboutTarget(link('/abouts'), ORIGIN)).toBeNull();
    expect(aboutTarget(link('https://elsewhere.example/about'), ORIGIN)).toBeNull();
    expect(aboutTarget(link('/about', { target: '_blank' }), ORIGIN)).toBeNull();
    expect(aboutTarget(link('/about', { target: 'other' }), ORIGIN)).toBeNull();
    expect(aboutTarget(link('/about', { download: true }), ORIGIN)).toBeNull();
  });

  it('a malformed fragment is taken as written, never thrown on', () => {
    expect(aboutTarget(link('/about#100%'), ORIGIN)).toBe('100%');
  });
});
