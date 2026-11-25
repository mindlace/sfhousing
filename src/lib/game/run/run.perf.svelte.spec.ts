// The run layer's frame budget (run-play design, sec-d-budget): the p95 of one `step` plus one
// `drawRun` on a real software canvas, 1280 by 720 CSS px at pixel ratio 2, with 3,000 drops over
// 600 frames of 16.7 ms on a fake clock. Wall-clock, so it runs with `npm run test:perf` on a quiet
// machine and is not in signoff.
import { describe, expect, it } from 'vitest';
import { BASE_HANDS } from '../limits';
import type { Drop } from './drops';
import { DRAW, drawRun, type Look } from './draw';
import { createRun, pointRing, setBox, step } from './run-model';

export const RUN_FRAME_P95_MS = 2;

const W = 1280;
const H = 720;
const DPR = 2;
const FRAMES = 600;
const FRAME_MS = 16.7;
const WARMUP = 60;
const DROPS = 3000;
const BURST = 500;
const BURST_FRAME = 100;
const RING_RADIUS = 200;
const RING_POINTS = 8;

const LOOK: Look = {
  accent: '#1a6ee0',
  policy: '#c2410c',
  ink: '#111111',
  surface: '#ffffff',
  font: 'sans-serif'
};

/** 3,000 drops in day order, day = frame number: 500 on the burst frame, the rest spread evenly. */
function makeDrops(): Drop[] {
  const days: number[] = [];
  for (let k = 0; k < BURST; k++) days.push(BURST_FRAME);
  const others: number[] = [];
  for (let f = 0; f < FRAMES; f++) if (f !== BURST_FRAME) others.push(f);
  const rest = DROPS - BURST;
  for (let k = 0; k < rest; k++) days.push(others[Math.floor((k * others.length) / rest)]);
  days.sort((a, b) => a - b);
  return days.map((day, n) => ({
    row: n,
    lng: (n * 37) % W,
    lat: (n * 91) % H,
    day,
    worth: { home: 1 + (n % 4) },
    policy: n % 5 === 4
  }));
}

function p95(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

describe('run layer frame budget', () => {
  it('keeps step plus drawRun within RUN_FRAME_P95_MS at p95', () => {
    const canvas = document.createElement('canvas');
    canvas.width = W * DRAW.maxDpr;
    canvas.height = H * DRAW.maxDpr;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    const drops = makeDrops();
    const m = createRun();
    setBox(m, W, H);
    const project = (lng: number, lat: number) => ({ x: lng, y: lat });
    const cx = W / 2;
    const cy = H / 2;

    let angle = 0;
    const times: number[] = [];
    for (let f = 0; f < FRAMES; f++) {
      const now = f * FRAME_MS;
      for (let k = 0; k < RING_POINTS; k++) {
        angle += (Math.PI * 2) / 240;
        pointRing(
          m,
          { x: cx + RING_RADIUS * Math.cos(angle), y: cy + RING_RADIUS * Math.sin(angle) },
          f === 0 && k === 0
        );
      }
      const t0 = performance.now();
      step(m, {
        now,
        running: true,
        day: f,
        drops,
        hands: BASE_HANDS,
        auto: BASE_HANDS.auto,
        reduced: false,
        project
      });
      drawRun(ctx, m, {
        now,
        look: LOOK,
        reduced: false,
        radiusPx: BASE_HANDS.radiusPx,
        showRing: true
      });
      const dt = performance.now() - t0;
      if (f >= WARMUP) times.push(dt);
    }

    const measured = p95(times);
    console.info(`run frame p95 ${measured.toFixed(3)} ms over ${times.length} frames`);
    expect(Object.values(m.take.dropped).reduce((a, b) => a + (b ?? 0), 0)).toBeGreaterThan(0);
    expect(m.seen.size).toBe(DROPS);
    expect(measured).toBeLessThanOrEqual(RUN_FRAME_P95_MS);
  });
});
