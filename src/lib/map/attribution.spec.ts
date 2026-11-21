import { describe, expect, it } from 'vitest';
import { creditHtml } from './attribution';

describe('creditHtml', () => {
  it('creditHtml: "© OpenStreetMap" to the copyright page, then " · ", then "About this model" to /about#about-data', () => {
    expect(creditHtml()).toBe(
      '<a href="https://www.openstreetmap.org/copyright" rel="noopener noreferrer">© OpenStreetMap</a>' +
        ' · ' +
        '<a href="/about#about-data">About this model</a>'
    );
    // No title: the words are the whole credit.
    expect(creditHtml()).not.toContain('title=');
  });
});
