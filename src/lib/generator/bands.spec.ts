import { describe, expect, it } from 'vitest';
import { occupiedArea, bandsSupported, unitsFor, retainsCapacity } from './bands';
import type { FloorBand, OccupiedComposition } from './composition-types';
const rect = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h }
];
const model = (area: number): OccupiedComposition => ({
  family: 'simple',
  typology: 'podium',
  stories: 6,
  bands: [
    { firstFloor: 1, floors: 5, regions: [rect(0, 0, 10, 10)] },
    { firstFloor: 6, floors: 1, regions: [rect(0, 0, area - 500, 1)] }
  ]
});
describe('occupied floor bands', () => {
  it('counts sibling plates once and supports unequal heights', () => {
    const bands: FloorBand[] = [
      { firstFloor: 1, floors: 2, regions: [rect(0, 0, 10, 10)] },
      { firstFloor: 3, floors: 3, regions: [rect(0, 0, 4, 5), rect(5, 0, 5, 6)] }
    ];
    expect(occupiedArea(bands)).toBe(350);
    expect(bandsSupported(bands)).toBe(true);
    bands[1].regions[1] = rect(5, 0, 10, 6);
    expect(bandsSupported(bands)).toBe(false);
  });
  it('unions overlapping bands instead of double counting them', () => {
    expect(
      occupiedArea([
        { firstFloor: 1, floors: 3, regions: [rect(0, 0, 10, 10)] },
        { firstFloor: 2, floors: 2, regions: [rect(0, 0, 5, 10)] }
      ])
    ).toBe(300);
  });
  it('rejects unsupported gaps and malformed floor counts', () => {
    expect(bandsSupported([{ firstFloor: 2, floors: 1, regions: [rect(0, 0, 10, 10)] }])).toBe(
      false
    );
    expect(bandsSupported([{ firstFloor: 1, floors: 0.5, regions: [rect(0, 0, 10, 10)] }])).toBe(
      false
    );
  });
  it('checks rounded unit retention separately from floor-area retention', () => {
    expect(unitsFor('podium', 600)).toBe(7);
    expect(unitsFor('podium', 580)).toBe(7);
    expect(unitsFor('podium', 560)).toBe(6);
    expect(retainsCapacity(model(580), model(600))).toBe(true);
    expect(retainsCapacity(model(560), model(600))).toBe(false);
    expect(retainsCapacity(model(530), model(600))).toBe(false);
    expect(unitsFor('plex', 10000)).toBe(4);
    expect(unitsFor('adu', 10000)).toBe(1);
  });
});

it('accounts for siblings ending on different floors', () => {
  const bands: FloorBand[] = [
    { firstFloor: 1, floors: 2, regions: [rect(0, 0, 10, 10)] },
    { firstFloor: 3, floors: 3, regions: [rect(0, 0, 4, 5)] },
    { firstFloor: 3, floors: 2, regions: [rect(5, 0, 5, 6)] }
  ];
  expect(occupiedArea(bands)).toBe(320);
  expect(bandsSupported(bands)).toBe(true);
});
