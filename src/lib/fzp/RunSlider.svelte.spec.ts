/// <reference types="@vitest/browser-playwright" />
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import '../../routes/layout.css';
import RunSliderHost from './RunSliderHost.test.svelte';
import RunSlider from './RunSlider.svelte';

const RANKS = Array.from({ length: 101 }, (_, i) => 1000 + ((i * 37) % 101));
const slider = () => page.getByTestId('run-slider');

describe('RunSlider', () => {
  it("shows Best and Worst, the handle's seed and the value text", async () => {
    await render(RunSlider, {
      props: {
        ranks: RANKS,
        position: 11,
        shownSeed: RANKS[11],
        disabled: false,
        onselect: vi.fn()
      }
    });
    await expect.element(page.getByText('Best')).toBeInTheDocument();
    await expect.element(page.getByText('Worst')).toBeInTheDocument();
    await expect.element(page.getByText(`#${RANKS[11]}`)).toBeInTheDocument();
    await expect
      .element(slider())
      .toHaveAttribute('aria-valuetext', `Run ${RANKS[11]}, rank 12 of 101`);
    await expect.element(slider()).toHaveAttribute('aria-valuenow', '90');
  });

  it('keys select positions', async () => {
    const calls: number[] = [];
    await render(RunSliderHost, {
      props: { ranks: RANKS, start: 11, record: (p: number) => calls.push(p) }
    });
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowUp}');
    await userEvent.keyboard('{Home}');
    await userEvent.keyboard('{PageDown}');
    await userEvent.keyboard('{End}');
    expect(calls).toEqual([10, 0, 10, 100]);
  });

  it("clicking the track's top and bottom selects Best and Worst", async () => {
    const onselect = vi.fn();
    await render(RunSlider, {
      props: { ranks: RANKS, position: 50, shownSeed: null, disabled: false, onselect }
    });
    const track = page.getByTestId('run-slider-track');
    const inner = track.element() as HTMLElement;
    // Press at the exact top and bottom of the padding box (a real click lands a pixel or two in,
    // which on a 101-tick track can round to the next tick).
    const top = inner.getBoundingClientRect().top + inner.clientTop;
    for (const clientY of [top, top + inner.clientHeight]) {
      inner.dispatchEvent(
        new PointerEvent('pointerdown', { clientY, pointerId: 1, button: 0, bubbles: true })
      );
      inner.dispatchEvent(new PointerEvent('pointerup', { clientY, pointerId: 1, bubbles: true }));
    }
    expect(onselect.mock.calls.map((c) => c[0])).toEqual([0, 100]);
  });

  it('a drag selects the positions under the pointer, and nothing after the release', async () => {
    const calls: number[] = [];
    await render(RunSliderHost, {
      props: { ranks: RANKS, start: 50, record: (p: number) => calls.push(p) }
    });
    const inner = page.getByTestId('run-slider-track').element() as HTMLElement;
    const top = inner.getBoundingClientRect().top + inner.clientTop;
    const at = (p: number) => top + (p / 100) * inner.clientHeight;
    const fire = (type: string, p: number) =>
      inner.dispatchEvent(
        new PointerEvent(type, { clientY: at(p), pointerId: 1, button: 0, bubbles: true })
      );
    fire('pointerdown', 10);
    fire('pointermove', 20);
    fire('pointermove', 30);
    fire('pointerup', 30);
    fire('pointermove', 40);
    expect(calls).toEqual([10, 20, 30]);
  });

  it('disabled: aria-disabled, no selection on keys or clicks, handle on the middle tick', async () => {
    const onselect = vi.fn();
    await render(RunSlider, {
      props: { ranks: null, position: null, shownSeed: null, disabled: true, onselect }
    });
    await expect.element(slider()).toHaveAttribute('aria-disabled', 'true');
    await expect.element(slider()).toHaveAttribute('aria-valuenow', '51');
    (slider().element() as HTMLElement).focus();
    await userEvent.keyboard('{ArrowUp}{End}');
    await page.getByTestId('run-slider-track').click({ force: true });
    expect(onselect).not.toHaveBeenCalled();
  });

  it('no selected tick: no number on the handle, the not-ranked text', async () => {
    await render(RunSlider, {
      props: { ranks: RANKS, position: null, shownSeed: 4242, disabled: false, onselect: vi.fn() }
    });
    await expect
      .element(slider())
      .toHaveAttribute('aria-valuetext', 'Run 4242, not one of the 101 ranked runs');
    expect(document.body.textContent).not.toContain('#');
  });

  it('the handle is at least 24×24 px', async () => {
    await render(RunSlider, {
      props: {
        ranks: RANKS,
        position: 11,
        shownSeed: RANKS[11],
        disabled: false,
        onselect: vi.fn()
      }
    });
    const box = (slider().element() as HTMLElement).getBoundingClientRect();
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
  });
});
