import { FillRule, intersectD, type PathD } from 'clipper2-ts';
import proj4 from 'proj4';
import { describe, expect, it } from 'vitest';
import type { ParcelRecord } from '../data/parcel';
import { assembleSite, frameOffset } from './assemble';
import { domainArea } from './domain';
import { localFrame } from './geo';
import { signedArea } from './poly';
import { mulberry32 } from './seed';
import { normaliseSite } from './site';
import courtyardJson from './fixtures/assembly-courtyard.json';
import pairJson from './fixtures/assembly-pair.json';
import rowJson from './fixtures/assembly-row.json';
import streetJson from './fixtures/assembly-street.json';

proj4.defs(
  'EPSG:7131',
  '+proj=tmerc +lat_0=37.75 +lon_0=-122.45 +k=1.000007 +x_0=48000 +y_0=24000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'
);

interface Assembly {
  parcels: ParcelRecord[];
  excluded?: ParcelRecord;
}
const pair = pairJson as unknown as Assembly;
const row = rowJson as unknown as Assembly;
const street = streetJson as unknown as Assembly;
const courtyard = courtyardJson as unknown as Assembly;

const EDGE_INSET_M = 0.4;
const sum = (rs: ParcelRecord[]) => rs.reduce((s, r) => s + r.areaM2, 0);
const toPath = (ring: readonly (readonly number[])[]): PathD => ring.map(([x, y]) => ({ x, y }));
const outerRings = (polygon: [number, number][][]) =>
  polygon.filter((ring) => signedArea(toPath(ring)) > 0);

describe('frameOffset', () => {
  it('matches localFrame within 1e-6 m', () => {
    const rnd = mulberry32(1);
    let worst = 0;
    for (let i = 0; i < 1000; i++) {
      const from: [number, number] = [-122.52 + rnd() * 0.17, 37.7 + rnd() * 0.13];
      const to: [number, number] = [
        from[0] + (rnd() * 2 - 1) * 0.018,
        from[1] + (rnd() * 2 - 1) * 0.018
      ];
      const want = localFrame(from).from(...to);
      const got = frameOffset(from, to);
      worst = Math.max(worst, Math.abs(got[0] - want[0]), Math.abs(got[1] - want[1]));
    }
    expect(worst).toBeLessThanOrEqual(1e-6);
  });

  it('matches EPSG:7131 differences', () => {
    const rnd = mulberry32(2);
    let worst200 = 0;
    let worst500 = 0;
    let n200 = 0;
    let n500 = 0;
    for (let i = 0; i < 500; i++) {
      const from: [number, number] = [-122.52 + rnd() * 0.17, 37.7 + rnd() * 0.13];
      // up to ~500 m: 0.0045 deg of latitude is ~500 m, 0.0057 deg of longitude is ~500 m
      const to: [number, number] = [
        from[0] + (rnd() * 2 - 1) * 0.0057,
        from[1] + (rnd() * 2 - 1) * 0.0045
      ];
      const a = proj4('EPSG:4326', 'EPSG:7131', from);
      const b = proj4('EPSG:4326', 'EPSG:7131', to);
      const want = [b[0] - a[0], b[1] - a[1]];
      const dist = Math.hypot(want[0], want[1]);
      const got = frameOffset(from, to);
      const err = Math.hypot(got[0] - want[0], got[1] - want[1]);
      if (dist <= 200) {
        worst200 = Math.max(worst200, err);
        n200++;
      } else if (dist <= 500) {
        worst500 = Math.max(worst500, err);
        n500++;
      }
    }
    expect(n200).toBeGreaterThan(50);
    expect(n500).toBeGreaterThan(50);
    expect(worst200).toBeLessThanOrEqual(0.02);
    expect(worst500).toBeLessThanOrEqual(0.05);
  });
});

describe('assembleSite', () => {
  it('pair → one component, area = Σ areaM2 ± 0.5, anchor larger lot', () => {
    const a = assembleSite(pair.parcels)!;
    expect(a.anchor.id).toBe('3604002');
    expect(a.records.map((r) => r.id)).toEqual(['3604001', '3604002']);
    expect(outerRings(a.polygon)).toHaveLength(1);
    const site = normaliseSite(a.polygon, EDGE_INSET_M);
    expect(site).not.toBeNull();
    expect(Math.abs(domainArea(site!.originalDomain) - sum(pair.parcels))).toBeLessThanOrEqual(0.5);
  });

  it('pair with equal areas → the smaller id is the anchor', () => {
    const equal = pair.parcels.map((r) => ({ ...r, areaM2: 250 }));
    expect(assembleSite(equal)!.anchor.id).toBe('3604001');
    expect(assembleSite([...equal].reverse())!.anchor.id).toBe('3604001');
  });

  it('row → one component, area = Σ areaM2 ± 1', () => {
    const a = assembleSite(row.parcels)!;
    expect(outerRings(a.polygon)).toHaveLength(1);
    const site = normaliseSite(a.polygon, EDGE_INSET_M);
    expect(site).not.toBeNull();
    expect(Math.abs(domainArea(site!.originalDomain) - sum(row.parcels))).toBeLessThanOrEqual(1);
  });

  it('street → two components; normaliseSite keeps the larger', () => {
    const a = assembleSite(street.parcels)!;
    expect(a.anchor.id).toBe('3606001');
    expect(outerRings(a.polygon)).toHaveLength(2);
    const site = normaliseSite(a.polygon, EDGE_INSET_M);
    expect(site).not.toBeNull();
    expect(Math.abs(site!.A - street.parcels[0].areaM2)).toBeLessThanOrEqual(0.5);
  });

  it('courtyard → the excluded lot is a hole', () => {
    const a = assembleSite(courtyard.parcels)!;
    const site = normaliseSite(a.polygon, EDGE_INSET_M)!;
    expect(site).not.toBeNull();
    expect(site.originalDomain.some((ring) => signedArea(ring) < 0)).toBe(true);
    const ex = courtyard.excluded!;
    const [dx, dy] = frameOffset(a.anchor.labelPoint, ex.labelPoint);
    const exRing = ex.polygon[0].map(([x, y]) => ({ x: x + dx, y: y + dy }));
    const overlap = intersectD(site.domain, [exRing], FillRule.NonZero, 2);
    expect(domainArea(overlap)).toBeLessThanOrEqual(0.01);
  });

  it('one record → its polygon unchanged', () => {
    const a = assembleSite([pair.parcels[0]])!;
    expect(a.anchor).toBe(pair.parcels[0]);
    expect(a.polygon).toBe(pair.parcels[0].polygon);
  });

  it('input order and duplicates do not matter', () => {
    const base = assembleSite(row.parcels);
    const shuffled = [...row.parcels].reverse();
    const noisy = [...shuffled, row.parcels[1], row.parcels[0]];
    expect(assembleSite(shuffled)).toStrictEqual(base);
    expect(assembleSite(noisy)).toStrictEqual(base);
  });

  it('a malformed member is skipped', () => {
    const badLabel = { ...pair.parcels[0], id: '3604009', labelPoint: [NaN, 0] } as ParcelRecord;
    const noRings = { ...pair.parcels[0], id: '3604003', areaM2: 1, polygon: [] } as ParcelRecord;
    const junkRing = {
      ...pair.parcels[0],
      id: '3604004',
      areaM2: 1,
      polygon: [
        [
          [0, 0],
          [NaN, 1],
          [2, 2]
        ],
        [
          [0, 0],
          [1, 1]
        ]
      ]
    } as ParcelRecord;
    const alone = assembleSite(pair.parcels)!;
    const withBad = assembleSite([...pair.parcels, badLabel, noRings, junkRing])!;
    expect(withBad.polygon).toStrictEqual(alone.polygon);
    expect(withBad.anchor).toBe(alone.anchor);
    expect(withBad.records.map((r) => r.id)).toEqual(['3604001', '3604002', '3604003', '3604004']);
  });

  it('records with no usable rings leave an empty polygon', () => {
    const noRings = { ...pair.parcels[0], polygon: [] } as ParcelRecord;
    const a = assembleSite([noRings, { ...pair.parcels[1], polygon: [] }])!;
    expect(a.polygon).toEqual([]);
    expect(normaliseSite(a.polygon, EDGE_INSET_M)).toBeNull();
  });

  it('bad labelPoints everywhere → null', () => {
    const bad = pair.parcels.map((r) => ({ ...r, labelPoint: [NaN, NaN] }) as ParcelRecord);
    const short = { ...pair.parcels[0], labelPoint: [1] } as unknown as ParcelRecord;
    expect(assembleSite([...bad, short])).toBeNull();
  });

  it('[] → null', () => {
    expect(assembleSite([])).toBeNull();
  });
});
