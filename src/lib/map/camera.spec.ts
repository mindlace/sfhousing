import { describe, expect, it } from 'vitest';
import { SF_GRID_BBOX } from '$lib/transit/grid';
import {
  RUN_BOUNDS,
  RUN_MIN_ZOOM,
  RUN_PAD_PX,
  defaultFrame,
  initialCamera,
  pixelRatio,
  runFrame
} from './camera';

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

describe('runFrame', () => {
  it("runFrame(1280, 744, 0) fits by height: zoom 11.603, the bounds' Mercator centre, flat and north up", () => {
    const f = runFrame(1280, 744, 0);
    expect(f.zoom).toBeCloseTo(11.603, 3);
    expect(f.center[0]).toBeCloseTo(-122.4352, 4);
    expect(f.center[1]).toBeCloseTo(37.77023, 4);
    expect([f.pitch, f.bearing]).toEqual([0, 0]);
  });
  it('runFrame(375, 600, 0): a portrait box is fitted by width', () => {
    expect(runFrame(375, 600, 0).zoom).toBeCloseTo(10.483, 3);
  });
  it('runFrame(1280, 744, 300): the inset is taken from the height', () => {
    expect(runFrame(1280, 744, 300).zoom).toBeCloseTo(10.789, 3);
  });
  it('a box too small for the city gets RUN_MIN_ZOOM', () => {
    expect(runFrame(100, 100, 0).zoom).toBe(RUN_MIN_ZOOM);
    expect(runFrame(40, 40, 0).zoom).toBe(RUN_MIN_ZOOM);
    expect(RUN_MIN_ZOOM).toBe(8);
  });
  it('RUN_BOUNDS is SF_GRID_BBOX', () => {
    expect(RUN_BOUNDS).toEqual(SF_GRID_BBOX);
    expect(RUN_PAD_PX).toBe(24);
  });
});
