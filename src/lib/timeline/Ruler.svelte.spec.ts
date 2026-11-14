/// <reference types="@vitest/browser-playwright" />
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import '../../routes/layout.css';
import { dayFromUtc } from '$lib/fzp/time';
import Ruler from './Ruler.svelte';

describe('Ruler', () => {
  const asOf = dayFromUtc(2026, 10, 15);
  const windowEnd = dayFromUtc(2066, 10, 31);
  it('labels the years from the dataset date, fills to the mark and jumps from markers', async () => {
    const onjump = vi.fn();
    const rhna = dayFromUtc(2031, 1, 31);
    await render(Ruler, {
      props: {
        asOf,
        windowEnd,
        filledEnd: dayFromUtc(2046, 10, 15),
        markers: [
          { day: rhna, label: 'RHNA deadline', name: 'Jump to RHNA deadline, January 2031' },
          { day: dayFromUtc(2045, 1, 1), label: '2045', name: 'Jump to 2045' }
        ],
        onjump
      }
    });
    await expect.element(page.getByText('2026')).toBeVisible();
    await expect.element(page.getByText('2066')).toBeVisible();
    const filled = page.getByTestId('tl-ruler-filled').element() as HTMLElement;
    expect(parseFloat(filled.style.width)).toBeCloseTo(50, 0);
    const rest = page.getByTestId('tl-ruler-unfilled').element() as HTMLElement;
    expect(parseFloat(rest.style.left)).toBeCloseTo(parseFloat(filled.style.width), 3);
    expect(getComputedStyle(rest).backgroundImage).toContain('repeating-linear-gradient');
    await page.getByRole('button', { name: 'Jump to RHNA deadline, January 2031' }).click();
    expect(onjump).toHaveBeenCalledWith(rhna);
  });
});
