import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clipYieldLoss, landClipSection } from '../lib/land-report';
import { landDb, type Rect } from './land-helpers';

const T: Rect = [0, 0, 100, 100];

describe('clipYieldLoss', () => {
  it('fires when a lot keeps most of its area but loses all yield', () => {
    expect(
      clipYieldLoss([
        { id: 'a', keptShare: 0.99, clippedTop: 0, originalTop: 48 },
        { id: 'b', keptShare: 0.99, clippedTop: 40, originalTop: 48 },
        { id: 'c', keptShare: 0.5, clippedTop: 0, originalTop: 48 }
      ])
    ).toEqual({ fired: 1, of: 2, sample: ['a'] });
  });
  it('does not fire on a lot that never had yield', () => {
    expect(clipYieldLoss([{ id: 'a', keptShare: 0.99, clippedTop: 0, originalTop: 0 }])).toEqual({
      fired: 0,
      of: 1,
      sample: []
    });
  });
});

describe('landClipSection', () => {
  it('writes the land section with the largest removals first', async () => {
    const db = await landDb({
      lots: [
        { id: 's1', rect: [80, 10, 120, 40] },
        { id: 'u1', rect: [120, 10, 150, 40] },
        { id: 'i1', rect: [10, 10, 40, 40] }
      ],
      land: [{ layer: 'earth', tile: T, rect: T }]
    });
    await db.run(`CREATE TABLE parcel_out AS SELECT id, 'RESIDENTIAL' AS land_use FROM parcels`);
    const md = await landClipSection(db);
    expect(md).toMatch(/^## Land clip/);
    expect(md.indexOf('| u1 ')).toBeGreaterThan(-1);
    expect(md.indexOf('| u1 ')).toBeLessThan(md.indexOf('| s1 '));
    expect(md).not.toContain('| i1 ');
  });
});

describe('the mini build', () => {
  it('reports clip-yield-loss with nothing fired and nothing at risk', () => {
    const { counts } = JSON.parse(
      readFileSync('pipeline/test/fixtures/mini/golden/report.json', 'utf8')
    );
    expect(counts['quality.sd.parcels.clip-yield-loss.fired']).toBe(0);
    expect(counts['quality.sd.parcels.clip-yield-loss.of']).toBe(0);
  });
});
