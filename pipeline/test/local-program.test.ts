import { describe, expect, it } from 'vitest';
import { MAX_STORIES } from '../../src/lib/generator/constants';
import { parseHeightDistrict, storiesFromFt, type HeightDistrict } from '../lib/heights';
import { localProgramEnvelope } from '../lib/local-program';

const d = (s: string): HeightDistrict => parseHeightDistrict(s);

describe('localProgramEnvelope', () => {
  it('uses the Local Program height on an R-4 parcel', () => {
    expect(
      localProgramEnvelope({ district: d('40//65-R-4'), lotAreaM2: 300, excluded: false })
    ).toEqual({
      baseStories: 4,
      envelopeStories: 6,
      localProgram: true,
      largeLot65: false
    });
  });

  it('large-lot bump: 800 m2 on 40//40-R-4 lifts the envelope to 65 ft', () => {
    expect(
      localProgramEnvelope({ district: d('40//40-R-4'), lotAreaM2: 800, excluded: false })
    ).toEqual({
      baseStories: 4,
      envelopeStories: 6,
      localProgram: true,
      largeLot65: true
    });
  });

  it('no bump below 743.2 m2, bump at exactly 743.2 m2', () => {
    const below = localProgramEnvelope({
      district: d('40//40-R-4'),
      lotAreaM2: 743.19,
      excluded: false
    });
    expect(below).toMatchObject({ envelopeStories: 4, largeLot65: false });
    const at = localProgramEnvelope({
      district: d('40//40-R-4'),
      lotAreaM2: 743.2,
      excluded: false
    });
    expect(at).toMatchObject({ envelopeStories: 6, largeLot65: true });
  });

  it('no bump when the Local Program height is already 65 ft or more', () => {
    const r = localProgramEnvelope({ district: d('40//65-R-4'), lotAreaM2: 2000, excluded: false });
    expect(r).toMatchObject({ envelopeStories: 6, largeLot65: false });
  });

  it('lpFt below baseFt takes the max', () => {
    const district: HeightDistrict = {
      kind: 'height',
      baseFt: 85,
      lpFt: 65,
      r4: true,
      normalised: 'synthetic'
    };
    expect(localProgramEnvelope({ district, lotAreaM2: 300, excluded: false })).toEqual({
      baseStories: 8,
      envelopeStories: 8,
      localProgram: true,
      largeLot65: false
    });
  });

  it('an R-4 string with no // uses its own height (lpFt = baseFt)', () => {
    const r = localProgramEnvelope({ district: d('85-R-4'), lotAreaM2: 300, excluded: false });
    expect(r).toMatchObject({ baseStories: 8, envelopeStories: 8, localProgram: true });
  });

  it('excluded R-4 parcel takes base stories and is not Local Program', () => {
    expect(
      localProgramEnvelope({ district: d('40//85-R-4'), lotAreaM2: 800, excluded: true })
    ).toEqual({
      baseStories: 4,
      envelopeStories: 4,
      localProgram: false,
      largeLot65: false
    });
  });

  it('a non-R-4 // string takes the base side, not the Local Program side', () => {
    const r = localProgramEnvelope({
      district: d('85-X // 120/400-R-2'),
      lotAreaM2: 300,
      excluded: false
    });
    expect(r).toEqual({
      baseStories: 8,
      envelopeStories: 8,
      localProgram: false,
      largeLot65: false
    });
  });

  it('a large lot outside R-4 gets no bump', () => {
    const r = localProgramEnvelope({ district: d('40-X'), lotAreaM2: 2000, excluded: false });
    expect(r).toMatchObject({ envelopeStories: 4, localProgram: false, largeLot65: false });
  });

  it('none gives 0/0/false/false', () => {
    expect(
      localProgramEnvelope({ district: { kind: 'none' }, lotAreaM2: 800, excluded: false })
    ).toEqual({
      baseStories: 0,
      envelopeStories: 0,
      localProgram: false,
      largeLot65: false
    });
  });

  it('stories clamp at 80', () => {
    expect(MAX_STORIES).toBe(80);
    expect(storiesFromFt(900)).toBe(80);
    const district: HeightDistrict = {
      kind: 'height',
      baseFt: 100,
      lpFt: 900,
      r4: true,
      normalised: 'synthetic'
    };
    expect(localProgramEnvelope({ district, lotAreaM2: 300, excluded: false })).toMatchObject({
      baseStories: 10,
      envelopeStories: 80
    });
  });
});
