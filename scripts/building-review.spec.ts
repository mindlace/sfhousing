import { describe, expect, it } from 'vitest';
import {
  REVIEW_VIEWS,
  renderReviewHtml,
  reviewStats,
  sampleBuildings,
  type RoofRow
} from './building-review';

const IDS = [
  'downtown-rincon',
  'transamerica-fidi',
  'sutro',
  'civic-center',
  'ferry-building',
  'ucsf-parnassus',
  'noe-false-fronts',
  'outer-sunset-rows',
  'presidio-heights-trees',
  'russian-hill-slope'
];

const report = {
  counts: {
    'boxes.buildings': 100,
    'boxes.src.box': 10,
    'boxes.src.base': 40,
    'boxes.src.front': 5,
    'boxes.src.step': 15,
    'boxes.src.part': 30,
    'boxes.fallback.elevated': 2,
    'boxes.fallback.new_building': 3,
    'boxes.fallback.no_lidar': 4,
    'boxes.fallback.unreliable': 1,
    'boxes.reg.clusters': 50,
    'boxes.reg.fit': 30,
    'boxes.reg.none': 10,
    'boxes.reg.zero': 5,
    'boxes.reg.flagged': 5,
    'boxes.step.buildings': 8,
    'boxes.front.buildings': 4,
    'boxes.parts.uncovered_dropped': 12.5,
    'tiles.buildings.drops_z14plus': 0
  }
};

const roof = (bid: string, nStep: number, nFront = 0): RoofRow => ({
  bid,
  lng: -122.4,
  lat: 37.77,
  n_step: nStep,
  n_front: nFront
});

describe('REVIEW_VIEWS', () => {
  it("covers the spec's ten areas", () => {
    expect(REVIEW_VIEWS.map((v) => v.id)).toEqual(IDS);
    for (const v of REVIEW_VIEWS) {
      expect(v.pitch).toBeGreaterThanOrEqual(60);
      expect(v.pitch).toBeLessThanOrEqual(70);
      expect(v.zoom).toBeGreaterThanOrEqual(16);
      expect(v.zoom).toBeLessThanOrEqual(17);
    }
  });
});

describe('reviewStats', () => {
  it('shares sum to one and the fallback share is over buildings', () => {
    const s = reviewStats(report);
    const sum = Object.values(s.srcShares).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
    expect(s.srcShares.step).toBeCloseTo(0.15, 12);
    expect(s.fallbackShare).toBeCloseTo(10 / 100, 12);
    expect(s.reg.fit).toBeCloseTo(30 / 50, 12);
    expect(s.stepBuildings).toBe(8);
    expect(s.frontBuildings).toBe(4);
    expect(s.stepBoxes).toBe(15);
    expect(s.frontBoxes).toBe(5);
    expect(s.uncoveredDropped).toBe(12.5);
    expect(s.drops).toBe(0);
  });

  it('is zero, not NaN, on an empty report', () => {
    const s = reviewStats({ counts: {} });
    expect(s.fallbackShare).toBe(0);
    expect(s.srcShares.box).toBe(0);
  });
});

describe('sampleBuildings', () => {
  const rows = [
    ...Array.from({ length: 40 }, (_, i) => roof(`s${i}`, 1 + (i % 3))),
    ...Array.from({ length: 20 }, (_, i) => roof(`n${i}`, 0, 1))
  ];

  it('is stable per version and takes only step buildings', () => {
    const a = sampleBuildings(rows, 'v1', 10);
    expect(a).toHaveLength(10);
    expect(a.every((r) => r.n_step > 0)).toBe(true);
    expect(sampleBuildings([...rows].reverse(), 'v1', 10)).toEqual(a);
    expect(sampleBuildings(rows, 'v2', 10).map((r) => r.bid)).not.toEqual(a.map((r) => r.bid));
  });

  it('can sample front buildings instead', () => {
    const f = sampleBuildings(rows, 'v1', 5, 'front');
    expect(f).toHaveLength(5);
    expect(f.every((r) => r.n_front > 0)).toBe(true);
  });
});

describe('renderReviewHtml', () => {
  const views = [{ ...REVIEW_VIEWS[0], name: 'Rincon <Hill>' }, REVIEW_VIEWS[1]];
  const html = renderReviewHtml({
    before: 'v-before',
    after: 'v-after',
    views,
    sample: [roof('b<1>', 2)],
    stats: reviewStats(report),
    tiles: { before: 1000, after: 1250 }
  });

  it('names both image paths per view', () => {
    for (const v of views) {
      expect(html).toContain(`before/${v.id}.png`);
      expect(html).toContain(`after/${v.id}.png`);
    }
    expect(html).toContain('before/sample-b_1_.png');
    expect(html).toContain('type="checkbox"');
  });

  it('escapes markup in names', () => {
    expect(html).toContain('Rincon &lt;Hill&gt;');
    expect(html).not.toContain('Rincon <Hill>');
    expect(html).not.toContain('b<1>');
  });

  it('includes the tile bytes change as a percentage', () => {
    expect(html).toContain('+25.0%');
  });
});
