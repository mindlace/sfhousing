import { describe, expect, it } from 'vitest';
import { M_PER_DEG_LNG } from '$lib/plan/geometry';
import { NO_ZOOM } from './types';
import {
  LABEL_H_PX,
  LID_ZOOMS,
  declutter,
  labelWidthPx,
  metersPerPixel,
  placeLabels,
  toLabelSet,
  type LabelCandidate
} from './labels';

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

  it('labelWidthPx: digits and + wide, spaces and dots narrow, letters between', () => {
    expect(labelWidthPx('8')).toBe(8.5);
    expect(labelWidthPx(' ·,')).toBe(12);
    expect(labelWidthPx('6 stories · +16 floors')).toBeCloseTo(138.5, 5);
  });

  it('placeLabels sizes a box by labelWidthPx: two wide labels collide where two short ones fit', () => {
    // 40 m apart east-west at z17 (≈ 0.47 m/px): ≈ 85 px apart.
    const east = -122.4431 + 40 / M_PER_DEG_LNG;
    const short = placeLabels(
      [cand({ text: '4', priority: 2 }), cand({ lng: east, text: '8' })],
      [17]
    );
    expect([...short]).toEqual([17, 17]);
    const long = placeLabels(
      [
        cand({ text: '6 stories · +16 floors', priority: 2 }),
        cand({ lng: east, text: '6 stories · +41 floors' })
      ],
      [17]
    );
    expect([...long]).toEqual([17, NO_ZOOM]);
  });

  it('declutter: in screen px, the first of two labels on one point shows, never both', () => {
    const at = (x: number, y: number) => ({ x, y });
    const proj = new Map([
      ['a', at(100, 100)],
      ['b', at(100, 100)],
      ['c', at(400, 100)]
    ]);
    const kept = declutter(
      ['a', 'b', 'c'],
      (k) => k,
      (k) => [proj.get(k)!.x, proj.get(k)!.y]
    );
    expect(kept).toEqual(['a', 'c']);
  });

  it('declutter: a pair clear of each other flat collides once pitch squeezes their rows together', () => {
    const text = '6 stories · +16 floors';
    const rows = (dy: number) => [
      { text, y: 100 },
      { text, y: 100 + dy }
    ];
    const pos = (l: { y: number }): [number, number] => [200, l.y];
    // flat: two rows 30 px apart are clear (box height 16 + 2 × 4 padding = 24)
    expect(declutter(rows(30), (l) => l.text, pos)).toHaveLength(2);
    // pitched 60°: the same ground rows are 15 px apart on screen
    expect(declutter(rows(15), (l) => l.text, pos)).toHaveLength(1);
    expect(LABEL_H_PX).toBe(16);
  });
});
