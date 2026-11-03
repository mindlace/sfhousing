import { describe, expect, it } from 'vitest';
import { SRC_FZP, SRC_NONE, SRC_PAINT, SRC_RULE0 } from '$lib/sim/levers/source';
import { CHAIN_LIMIT, CHAIN_SOURCE } from './types';
import {
  DIM_ALPHA,
  GLAZE_ALPHA,
  chainLook,
  chainWidthPx,
  glazeAlpha,
  labelDim,
  lidsOpacity,
  resolveMode,
  rimLook,
  wallAlpha,
  type LimitsMode
} from './limits-style';

const PLAIN: LimitsMode = { kind: 'plain' };
const PAINT: LimitsMode = { kind: 'paint' };

describe('limits style', () => {
  it('plain: source rims hidden, limit rims solid ink', () => {
    expect(rimLook(CHAIN_SOURCE, SRC_FZP, PLAIN).show).toBe(false);
    expect(rimLook(CHAIN_LIMIT, SRC_PAINT, PLAIN)).toEqual({
      show: true,
      dashed: false,
      tone: 'ink',
      alpha: 1
    });
    expect(chainLook(CHAIN_SOURCE, SRC_PAINT, SRC_FZP, PLAIN).show).toBe(false);
    expect(chainLook(CHAIN_LIMIT, SRC_FZP, SRC_NONE, PLAIN)).toMatchObject({
      show: true,
      dashed: false,
      tone: 'ink',
      alpha: 1
    });
  });

  it('paint: paint-owned rims and paint boundaries are dashed paint; others unchanged', () => {
    expect(rimLook(CHAIN_SOURCE, SRC_PAINT, PAINT)).toEqual({
      show: true,
      dashed: true,
      tone: 'paint',
      alpha: 1
    });
    expect(rimLook(CHAIN_LIMIT, SRC_FZP, PAINT).dashed).toBe(false);
    expect(rimLook(CHAIN_SOURCE, SRC_FZP, PAINT).show).toBe(false);
    expect(chainLook(CHAIN_SOURCE, SRC_PAINT, SRC_FZP, PAINT).dashed).toBe(true);
    expect(chainLook(CHAIN_LIMIT, SRC_FZP, SRC_PAINT, PAINT)).toMatchObject({
      show: true,
      dashed: true,
      tone: 'paint'
    });
    expect(chainLook(CHAIN_SOURCE, SRC_FZP, SRC_RULE0, PAINT).show).toBe(false);
  });

  it('rule s: its rims and its lot-set outline full, others dimmed; glaze only on s', () => {
    const m = { kind: 'rule', source: SRC_RULE0 } as const;
    expect(rimLook(CHAIN_SOURCE, SRC_RULE0, m).alpha).toBe(1);
    expect(rimLook(CHAIN_LIMIT, SRC_FZP, m).alpha).toBe(DIM_ALPHA);
    expect(rimLook(CHAIN_SOURCE, SRC_FZP, m).show).toBe(false);
    expect(glazeAlpha(SRC_FZP, 3, m)).toBe(0);
    expect(glazeAlpha(SRC_RULE0, 3, m)).toBe(GLAZE_ALPHA[3]);
    expect(chainLook(CHAIN_SOURCE, SRC_RULE0, SRC_FZP, m)).toMatchObject({ show: true, alpha: 1 });
    expect(chainLook(CHAIN_LIMIT, SRC_FZP, SRC_PAINT, m).alpha).toBe(DIM_ALPHA);
    expect(wallAlpha(SRC_RULE0, m)).toBe(1);
    expect(wallAlpha(SRC_FZP, m)).toBe(DIM_ALPHA);
  });

  it('rule s: the outline of its lot set is 2 px; other chains take no width', () => {
    const m = { kind: 'rule', source: SRC_RULE0 } as const;
    expect(chainLook(CHAIN_SOURCE, SRC_FZP, SRC_RULE0, m).widthPx).toBe(2);
    expect(chainLook(CHAIN_LIMIT, SRC_RULE0, SRC_NONE, m).widthPx).toBe(2);
    expect(chainLook(CHAIN_LIMIT, SRC_RULE0, SRC_RULE0, m).widthPx).toBeUndefined();
    expect(chainLook(CHAIN_LIMIT, SRC_FZP, SRC_NONE, m).widthPx).toBeUndefined();
    expect(chainLook(CHAIN_LIMIT, SRC_FZP, SRC_NONE, PLAIN).widthPx).toBeUndefined();
  });

  it('a rule that decides nothing dims everything', () => {
    // Review Focus 2
    const none = { kind: 'rule', source: -1 } as const;
    expect(rimLook(CHAIN_LIMIT, SRC_FZP, none).alpha).toBe(DIM_ALPHA);
    expect(chainLook(CHAIN_LIMIT, SRC_FZP, SRC_NONE, none).alpha).toBe(DIM_ALPHA);
    expect(glazeAlpha(SRC_FZP, 2, none)).toBe(0);
    expect(wallAlpha(SRC_FZP, none)).toBe(DIM_ALPHA);
  });

  it('glaze steps scale the token alpha outside rule mode; walls full', () => {
    expect([0, 1, 2, 3].map((s) => glazeAlpha(SRC_FZP, s, PLAIN))).toEqual([...GLAZE_ALPHA]);
    expect(glazeAlpha(SRC_PAINT, 1, PAINT)).toBe(GLAZE_ALPHA[1]);
    expect(wallAlpha(SRC_FZP, PLAIN)).toBe(1);
  });

  it('contour widths: 1 px below a 4-story step, 1.5 from 4 to 11, 2 from 12', () => {
    expect([
      chainWidthPx(5, 2),
      chainWidthPx(8, 4),
      chainWidthPx(15, 4),
      chainWidthPx(16, 4)
    ]).toEqual([1, 1.5, 1.5, 2]);
    expect(chainWidthPx(4, 0)).toBe(1.5);
  });

  it('crossfade', () => {
    expect([14, 14.5, 15, 15.5, 17].map(lidsOpacity)).toEqual([0, 0, 0.5, 1, 1]);
  });

  it('a selected rule id maps to its code in each source list', () => {
    expect(resolveMode({ kind: 'plain' }, ['a'])).toEqual(PLAIN);
    expect(resolveMode({ kind: 'paint' }, ['a'])).toEqual(PAINT);
    expect(resolveMode({ kind: 'rule', ruleId: 'b' }, ['a', 'b'])).toEqual({
      kind: 'rule',
      source: SRC_RULE0 + 1
    });
    expect(resolveMode({ kind: 'rule', ruleId: 'z' }, ['a', 'b'])).toEqual({
      kind: 'rule',
      source: -1
    });
  });

  it('the FZP baseline selected is rule mode on SRC_FZP: FZP-set lots in ink, the rest dimmed', () => {
    const m = resolveMode({ kind: 'fzp' }, ['a', 'b']);
    expect(m).toEqual({ kind: 'rule', source: SRC_FZP });
    expect(rimLook(CHAIN_LIMIT, SRC_FZP, m).alpha).toBe(1);
    expect(rimLook(CHAIN_LIMIT, SRC_RULE0, m).alpha).toBe(DIM_ALPHA);
  });

  it('rule mode dims the labels with none of the selected rule under them', () => {
    const sel = { kind: 'rule', source: SRC_RULE0 + 1 } as const;
    // a lid label: every source of its region; a contour label: both sides
    expect(labelDim([SRC_RULE0 + 1], sel)).toBe(false);
    expect(labelDim([SRC_FZP, SRC_RULE0 + 1], sel)).toBe(false);
    expect(labelDim([SRC_RULE0], sel)).toBe(true);
    expect(labelDim([SRC_FZP, SRC_RULE0], sel)).toBe(true);
    // a rule deciding nothing (-1) dims every label with owners
    expect(labelDim([SRC_FZP], { kind: 'rule', source: -1 })).toBe(true);
    // other modes and unowned labels never dim
    expect(labelDim([SRC_FZP], PLAIN)).toBe(false);
    expect(labelDim([SRC_FZP], PAINT)).toBe(false);
    expect(labelDim(undefined, sel)).toBe(false);
  });
});
