/// <reference types="@vitest/browser-playwright" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchCardArea } from './card-area-watch';

const frames = async (n = 3) => {
  for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(() => r(null)));
};

const made: HTMLElement[] = [];
function el(parent: HTMLElement = document.body, css = ''): HTMLElement {
  const e = document.createElement('div');
  e.style.cssText = css;
  parent.appendChild(e);
  made.push(e);
  return e;
}

afterEach(() => {
  for (const e of made.splice(0)) e.remove();
  document.documentElement.style.removeProperty('--map-controls-br-block-size');
  document.documentElement.style.removeProperty('--unrelated');
});

describe('watchCardArea', () => {
  it('does not re-measure for text changes inside the map (the scrubber readout, a tooltip)', async () => {
    const map = el(document.body, 'width:400px;height:300px');
    const readout = el(el(map));
    const onchange = vi.fn();
    const stop = watchCardArea({ map }, onchange);
    await frames(); // the observers' initial report
    onchange.mockClear();
    for (let i = 0; i < 8; i++) {
      readout.textContent = `April ${2027 + i}`;
      readout.appendChild(document.createElement('span'));
      await frames(1);
    }
    expect(onchange).not.toHaveBeenCalled();
    stop();
  });

  it('re-measures once, in a frame, when the pill stack changes height', async () => {
    const map = el(document.body, 'width:400px;height:300px');
    const pills = el(map, 'height:0');
    const onchange = vi.fn();
    const stop = watchCardArea({ map, pills }, onchange);
    await frames();
    onchange.mockClear();
    pills.style.height = '36px';
    pills.style.height = '40px';
    await frames();
    expect(onchange).toHaveBeenCalledTimes(1);
    stop();
  });

  it('re-measures when the map resizes', async () => {
    const map = el(document.body, 'width:400px;height:300px');
    const onchange = vi.fn();
    const stop = watchCardArea({ map }, onchange);
    await frames();
    onchange.mockClear();
    map.style.width = '500px';
    await frames();
    expect(onchange).toHaveBeenCalledTimes(1);
    stop();
  });

  it('re-measures when the dock swaps its panel for its rail, not for changes inside the panel', async () => {
    const map = el(document.body, 'width:400px;height:300px');
    const dock = el(map);
    const panel = el(dock);
    const onchange = vi.fn();
    const stop = watchCardArea({ map, dock }, onchange);
    await frames();
    onchange.mockClear();
    panel.appendChild(document.createElement('p'));
    panel.firstElementChild!.textContent = 'a tab changed';
    await frames();
    expect(onchange).not.toHaveBeenCalled();
    panel.remove();
    dock.appendChild(document.createElement('nav'));
    await frames();
    expect(onchange).toHaveBeenCalledTimes(1);
    stop();
  });

  it('re-measures when the bottom-right footprint changes, not for other root style changes', async () => {
    const map = el(document.body, 'width:400px;height:300px');
    const onchange = vi.fn();
    const stop = watchCardArea({ map }, onchange);
    await frames();
    onchange.mockClear();
    document.documentElement.style.setProperty('--unrelated', '1px');
    await frames();
    expect(onchange).not.toHaveBeenCalled();
    document.documentElement.style.setProperty('--map-controls-br-block-size', '96px');
    await frames();
    expect(onchange).toHaveBeenCalledTimes(1);
    stop();
  });

  it('watches the bottom-left controls too', async () => {
    const map = el(document.body, 'width:400px;height:300px');
    const controls = el(map, 'width:40px;height:100px');
    const onchange = vi.fn();
    const stop = watchCardArea({ map, controls }, onchange);
    await frames();
    onchange.mockClear();
    controls.style.width = '60px';
    await frames();
    expect(onchange).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stops observing once stopped', async () => {
    const map = el(document.body, 'width:400px;height:300px');
    const onchange = vi.fn();
    const stop = watchCardArea({ map }, onchange);
    await frames();
    stop();
    onchange.mockClear();
    map.style.width = '500px';
    document.documentElement.style.setProperty('--map-controls-br-block-size', '90px');
    await frames();
    expect(onchange).not.toHaveBeenCalled();
  });
});
