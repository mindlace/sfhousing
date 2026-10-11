import { describe, expect, it } from 'vitest';
import { defaultFrame, initialCamera, pixelRatio } from './camera';

describe('camera', () => {
  it('default frames by width', () => {
    expect(defaultFrame(1280)).toEqual({
      center: [-122.4194, 37.7749],
      zoom: 13,
      pitch: 55,
      bearing: -20
    });
    expect(defaultFrame(375)).toEqual({
      center: [-122.4194, 37.7749],
      zoom: 12.2,
      pitch: 45,
      bearing: -20
    });
    expect(defaultFrame(640).zoom).toBe(13);
  });
  it('fits the plan bbox with inset padding', () => {
    const c = initialCamera(375, 'plan-bbox', [-122.42, 37.76, -122.41, 37.77], 112);
    expect(c).toEqual({
      kind: 'fit',
      bounds: [
        [-122.42, 37.76],
        [-122.41, 37.77]
      ],
      options: { padding: 160, pitch: 45, bearing: -20, maxZoom: 16, animate: false }
    });
  });
  it('falls back to the default frame', () => {
    expect(initialCamera(1280, 'plan-bbox', undefined, 0)).toEqual({
      kind: 'jump',
      frame: defaultFrame(1280)
    });
    expect(initialCamera(1280, undefined, undefined, 0)).toEqual({
      kind: 'jump',
      frame: defaultFrame(1280)
    });
  });
  it('jumps to an explicit frame', () => {
    const frame = { center: [-122.4, 37.75] as [number, number], zoom: 14, pitch: 10, bearing: 5 };
    expect(initialCamera(1280, frame, undefined, 0)).toEqual({ kind: 'jump', frame });
  });
  it('caps pixel ratio at 2', () => {
    expect(pixelRatio(3)).toBe(2);
    expect(pixelRatio(1)).toBe(1);
  });
});
