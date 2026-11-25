import { describe, expect, it } from 'vitest';
import { dropCountText, runOverText } from './words';

describe('runOverText', () => {
  it('gives the totals', () => {
    const text = runOverText({ dropped: { home: 5678 }, collected: { home: 1234 } });
    expect(text).toBe('Run over. 1,234 of 5,678 homes collected.');
  });
});

describe('dropCountText', () => {
  it('formats with a plus', () => {
    expect(dropCountText(12)).toBe('+12');
    expect(dropCountText(1200)).toBe('+1,200');
  });
});
