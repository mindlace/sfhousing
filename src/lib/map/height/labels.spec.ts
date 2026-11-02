import { describe, expect, it } from 'vitest';
import { M_PER_DEG_LNG } from '$lib/plan/geometry';
import { NO_ZOOM } from './types';
import { LID_ZOOMS, metersPerPixel, placeLabels, toLabelSet, type LabelCandidate } from './labels';

function cand(o: Partial<LabelCandidate> = {}): LabelCandidate {
  return {
    lng: -122.4431,
    lat: 37.7562,
    zM: 10,
    text: '4 stories',
    priority: 1,
    roomM: 1000,
    ...o
  };
}

describe('labels', () => {
  it('metersPerPixel at z15 is about 1.889 m', () => {
    expect(metersPerPixel(15)).toBeCloseTo(1.889, 3);
  });

  it('two labels 50 m apart: the higher priority shows from z15, the other once they no longer overlap', () => {
    const z = placeLabels(
      [cand({ priority: 2 }), cand({ lng: -122.4431 + 50 / M_PER_DEG_LNG, priority: 1 })],
      LID_ZOOMS
    );
    expect(z[0]).toBe(15);
    expect(z[1]).toBeGreaterThan(15);
    expect(z[1]).toBeLessThan(NO_ZOOM);
  });

  it('a single 25 ft lot is labelled only at a zoom where its inscribed radius holds the box', () => {
    expect(placeLabels([cand({ roomM: 3.8 })], LID_ZOOMS)[0]).toBe(17);
    expect(placeLabels([cand({ roomM: 0.5 })], LID_ZOOMS)[0]).toBe(NO_ZOOM);
  });

  it('toLabelSet keeps placed labels with lng, lat, z', () => {
    const c = [cand({ zM: 7 }), cand({ text: 'x' })];
    const s = toLabelSet(c, Uint8Array.of(15, NO_ZOOM));
    expect(s.text).toEqual([c[0].text]);
    expect(Array.from(s.position)).toEqual([c[0].lng, c[0].lat, 7]);
    expect(Array.from(s.minZoom)).toEqual([15]);
  });
});
