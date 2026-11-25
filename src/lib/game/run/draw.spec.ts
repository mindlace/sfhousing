import { describe, expect, it } from 'vitest';
import { TOKENS } from '$lib/map/palette';
import { BASE_HANDS } from '../limits';
import { DRAW, dropRadius, drawRun, policyColour, type Look } from './draw';
import { RUN_CAPS, RUN_TIMES, createRun, setBox, step, type RunModel } from './run-model';
import type { Drop } from './drops';

interface Rec {
  op: string;
  args: number[] | [string, number, number];
  fillStyle: unknown;
  strokeStyle: unknown;
  globalAlpha: number;
  lineWidth: number;
  font: unknown;
}

function recorder(): { ctx: CanvasRenderingContext2D; rec: Rec[] } {
  const rec: Rec[] = [];
  const state: Record<string, unknown> = {
    fillStyle: '#000',
    strokeStyle: '#000',
    globalAlpha: 1,
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    lineJoin: 'miter'
  };
  const ctx: Record<string, unknown> = state;
  for (const op of [
    'clearRect',
    'beginPath',
    'arc',
    'moveTo',
    'lineTo',
    'closePath',
    'fill',
    'stroke',
    'fillText',
    'strokeText',
    'save',
    'restore'
  ]) {
    ctx[op] = (...args: number[]) => {
      rec.push({
        op,
        args,
        fillStyle: state.fillStyle,
        strokeStyle: state.strokeStyle,
        globalAlpha: state.globalAlpha as number,
        lineWidth: state.lineWidth as number,
        font: state.font
      });
    };
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rec };
}

interface Shape {
  kind: 'circle' | 'diamond';
  cx: number;
  cy: number;
  size: number;
  paints: Rec[];
}

function shapes(rec: Rec[]): Shape[] {
  const out: Shape[] = [];
  let pts: number[][] = [];
  let arc: number[] | null = null;
  let cur: Shape | null = null;
  for (const r of rec) {
    if (r.op === 'beginPath') {
      pts = [];
      arc = null;
      cur = null;
    } else if (r.op === 'arc') arc = r.args as number[];
    else if (r.op === 'moveTo' || r.op === 'lineTo') pts.push(r.args as number[]);
    else if (r.op === 'fill' || r.op === 'stroke') {
      if (!cur) {
        if (arc) cur = { kind: 'circle', cx: arc[0], cy: arc[1], size: arc[2], paints: [] };
        else {
          expect(pts).toHaveLength(4);
          cur = {
            kind: 'diamond',
            cx: pts[0][0],
            cy: (pts[0][1] + pts[2][1]) / 2,
            size: (pts[2][1] - pts[0][1]) / 2,
            paints: []
          };
        }
        out.push(cur);
      }
      cur.paints.push(r);
    }
  }
  return out;
}

const look: Look = {
  accent: '#a3472c',
  policy: '#00ff00',
  ink: '#111827',
  surface: '#ffffff',
  font: 'sans-serif'
};

function drop(row: number, homes = 4, x = 100, y = 100, policy = false): Drop {
  return { row, lng: x, lat: y, day: 0, worth: { home: homes }, policy };
}

function built(
  drops: Drop[],
  o: { now?: number; reduced?: boolean; auto?: boolean; point?: (d: Drop) => boolean } = {}
): RunModel {
  const m = createRun();
  setBox(m, 800, 600);
  const point = o.point ?? (() => true);
  step(m, {
    now: o.now ?? 0,
    running: true,
    day: 0,
    drops,
    hands: BASE_HANDS,
    auto: o.auto ?? false,
    reduced: o.reduced ?? true,
    project: (x, y) => (point({ lng: x, lat: y } as Drop) ? { x, y } : null)
  });
  return m;
}

function draw(m: RunModel, o: { now?: number; reduced?: boolean; showRing?: boolean } = {}) {
  const { ctx, rec } = recorder();
  drawRun(ctx, m, {
    now: o.now ?? 0,
    look,
    reduced: o.reduced ?? true,
    radiusPx: 30,
    showRing: o.showRing ?? false
  });
  return rec;
}

describe('draw', () => {
  it('DRAW.diamondScale is 1.25', () => {
    expect(DRAW.diamondScale).toBe(1.25);
    expect(DRAW.outlinePx).toBe(1.5);
    expect(DRAW.takenLinePx).toBe(2);
  });

  it('dropRadius: 4.5 at 1, 6 at 4, 9 at 16 and at 1,000', () => {
    expect(dropRadius(1)).toBe(4.5);
    expect(dropRadius(4)).toBe(6);
    expect(dropRadius(16)).toBe(9);
    expect(dropRadius(1000)).toBe(9);
  });

  it('policyColour is TOKENS[theme][tl-halo-policy] for each theme', () => {
    expect(policyColour(false)).toBe(TOKENS.light['tl-halo-policy']);
    expect(policyColour(true)).toBe(TOKENS.dark['tl-halo-policy']);
  });

  it('a live policy drop is a filled diamond in look.policy with half-diagonal 1.25 * dropRadius', () => {
    const rec = draw(built([drop(1, 4, 100, 100, true)]));
    expect(rec.some((r) => r.op === 'arc')).toBe(false);
    const [s] = shapes(rec);
    expect(s.kind).toBe('diamond');
    const pts = rec.filter((r) => r.op === 'moveTo' || r.op === 'lineTo').map((r) => r.args);
    expect(pts).toEqual([
      [100, 92.5],
      [107.5, 100],
      [100, 107.5],
      [92.5, 100]
    ]);
    expect(rec.some((r) => r.op === 'closePath')).toBe(true);
    expect(s.paints.map((p) => p.op)).toEqual(['fill', 'stroke']);
    expect(s.paints[0].fillStyle).toBe(look.policy);
    expect(s.paints[1].lineWidth).toBe(1.5);
    expect(s.paints[1].strokeStyle).toBe(look.surface);
  });

  it('a collected policy drop is a stroked diamond outline in look.policy, takenLinePx wide, no fill', () => {
    const rec = draw(built([drop(1, 4, 100, 100, true)], { auto: true }));
    const [s] = shapes(rec);
    expect(s.kind).toBe('diamond');
    expect(s.paints.map((p) => p.op)).toEqual(['stroke']);
    expect(s.paints[0].strokeStyle).toBe(look.policy);
    expect(s.paints[0].lineWidth).toBe(2);
    expect(s.size).toBe(7.5);
  });

  it('any other drop is a circle in the accent, filled live and stroked when collected', () => {
    const [live] = shapes(draw(built([drop(1, 4)])));
    expect(live.kind).toBe('circle');
    expect(live.size).toBe(6);
    expect(live.paints[0].op).toBe('fill');
    expect(live.paints[0].fillStyle).toBe(look.accent);
    expect(live.paints[1].strokeStyle).toBe(look.surface);
    const [taken] = shapes(draw(built([drop(1, 4)], { auto: true })));
    expect(taken.kind).toBe('circle');
    expect(taken.size).toBe(6);
    expect(taken.paints.map((p) => p.op)).toEqual(['stroke']);
    expect(taken.paints[0].lineWidth).toBe(2);
    expect(taken.paints[0].strokeStyle).toBe(look.accent);
  });

  it('draws at most 240 drops and 40 counts with 1,000 live, and draws the newest', () => {
    const drops: Drop[] = [];
    for (let i = 0; i < 1000; i++) drops.push(drop(i, 1, 10 + i / 2, 50, i % 2 === 1));
    const noPoint = (d: Drop) => Math.round((d.lng - 10) * 2) % 10 !== 0;
    const m = built(drops, { point: noPoint });
    const filled = shapes(draw(m)).filter((s) => s.paints[0].op === 'fill');
    expect(filled).toHaveLength(RUN_CAPS.maxDrawn);
    const withPoint = drops.filter((d) => noPoint({ lng: 10 + d.row / 2 } as Drop));
    const want = withPoint.slice(-240).map((d) => 10 + d.row / 2);
    expect(filled.map((s) => s.cx)).toEqual(want);
    const auto = built(drops, { auto: true });
    const rec = draw(auto);
    expect(rec.filter((r) => r.op === 'fillText')).toHaveLength(RUN_CAPS.maxCounts);
    expect(shapes(rec)).toHaveLength(RUN_CAPS.maxDrawn);
  });

  it('draws no ring when showRing is false; one ring of radiusPx when true', () => {
    const none = shapes(draw(built([]), { showRing: false }));
    expect(none).toHaveLength(0);
    const m = built([]);
    const rec = draw(m, { showRing: true });
    const [ring] = shapes(rec);
    expect(ring.kind).toBe('circle');
    expect(ring.size).toBe(30);
    expect([ring.cx, ring.cy]).toEqual([m.ring.x, m.ring.y]);
    expect(ring.paints.map((p) => p.op)).toEqual(['fill', 'stroke', 'stroke']);
    expect(ring.paints[0].fillStyle).toBe(look.accent);
    expect(ring.paints[0].globalAlpha).toBe(0.08);
    expect(ring.paints[1].strokeStyle).toBe(look.surface);
    expect(ring.paints[1].lineWidth).toBe(4);
    expect(ring.paints[1].globalAlpha).toBe(0.9);
    expect(ring.paints[2].strokeStyle).toBe(look.ink);
    expect(ring.paints[2].lineWidth).toBe(2);
  });

  it('with reduced motion draws every shape at full size and alpha 1', () => {
    const drops = [drop(1, 9, 100, 100, false), drop(2, 9, 200, 100, true)];
    const m = built(drops, { reduced: true });
    const [c, d] = shapes(draw(m, { now: 10, reduced: true }));
    expect(c.size).toBe(dropRadius(9));
    expect(d.size).toBe(1.25 * dropRadius(9));
    for (const p of [...c.paints, ...d.paints]) expect(p.globalAlpha).toBe(1);
    const taken = shapes(draw(built(drops, { auto: true }), { now: 10, reduced: true }));
    expect(taken[0].size).toBe(dropRadius(9));
    for (const s of taken) expect(s.paints[0].globalAlpha).toBe(1);
  });

  it('with motion a live drop grows over appearMs and fades over the last fadeMs', () => {
    const m = built([drop(1, 4)], { reduced: false });
    const born = m.live[0].bornMs;
    const end = m.live[0].endMs;
    const half = shapes(draw(m, { now: born + RUN_TIMES.appearMs / 2, reduced: false }))[0];
    expect(half.size).toBeCloseTo(6 * (1 - 0.5 ** 3), 10);
    const full = shapes(draw(m, { now: born + RUN_TIMES.appearMs, reduced: false }))[0];
    expect(full.size).toBe(6);
    expect(full.paints[0].globalAlpha).toBe(1);
    const fading = shapes(draw(m, { now: end - RUN_TIMES.fadeMs / 2, reduced: false }))[0];
    expect(fading.paints[0].globalAlpha).toBeCloseTo(0.5, 10);
  });

  it('with motion a collected drop grows and fades over takenMs and its count rises', () => {
    const m = built([drop(1, 4)], { reduced: false, auto: true, now: 1000 });
    const t = m.live[0].takenMs as number;
    const mid = draw(m, { now: t + RUN_TIMES.takenMs / 2, reduced: false });
    const [s] = shapes(mid);
    expect(s.size).toBeCloseTo(6 * 1.4, 10);
    expect(s.paints[0].globalAlpha).toBeCloseTo(0.45, 10);
    const texts = mid.filter((r) => r.op === 'fillText');
    expect(texts).toHaveLength(1);
    const p = RUN_TIMES.takenMs / 2 / RUN_TIMES.countMs;
    expect(texts[0].args).toEqual(['+4', 100, 100 - 6 - 4 - 18 * p]);
    expect(texts[0].globalAlpha).toBe(1);
    const late = draw(m, { now: t + RUN_TIMES.countMs * 0.8, reduced: false });
    expect(late.filter((r) => r.op === 'fillText')[0].globalAlpha).toBeCloseTo(0.5, 10);
  });

  it('a count is a surface halo under an ink fill in the page font', () => {
    const rec = draw(built([drop(1, 4)], { auto: true }));
    const ops = rec.filter((r) => r.op === 'strokeText' || r.op === 'fillText');
    expect(ops.map((r) => r.op)).toEqual(['strokeText', 'fillText']);
    expect(ops[0].strokeStyle).toBe(look.surface);
    expect(ops[0].lineWidth).toBe(3);
    expect(ops[1].fillStyle).toBe(look.ink);
    expect(ops[1].font).toBe('600 13px sans-serif');
    expect(ops[1].args).toEqual(['+4', 100, 100 - 6 - 4]);
  });

  it('clears the whole box first, then drops, counts, ring', () => {
    const rec = draw(built([drop(1, 4)], { auto: true }), { showRing: true });
    const first = rec.find((r) => r.op !== 'save');
    expect(first?.op).toBe('clearRect');
    expect(first?.args).toEqual([0, 0, 800, 600]);
    const iArc = rec.findIndex((r) => r.op === 'arc');
    const iText = rec.findIndex((r) => r.op === 'fillText');
    const iRing = rec.map((r) => r.op).lastIndexOf('arc');
    expect(iArc).toBeLessThan(iText);
    expect(iText).toBeLessThan(iRing);
  });
});
