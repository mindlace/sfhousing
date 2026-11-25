import { TOKENS } from '$lib/map/palette';
import { dropCountText } from './words';
import { RUN_CAPS, RUN_TIMES, type FloatCount, type LiveDrop, type RunModel } from './run-model';

export interface Look {
  accent: string;
  /** The map's policy mark colour, TOKENS[theme]['tl-halo-policy']. */
  policy: string;
  ink: string;
  surface: string;
  font: string;
}

export const DRAW = {
  dropMinPx: 3,
  dropPerSqrtPx: 1.5,
  dropMaxPx: 9,
  diamondScale: 1.25,
  outlinePx: 1.5,
  takenLinePx: 2,
  takenGrow: 0.8,
  takenAlpha: 0.9,
  countFontPx: 13,
  countWeight: 600,
  countGapPx: 4,
  countRisePx: 18,
  countHoldShare: 0.6,
  countHaloPx: 3,
  ringFillAlpha: 0.08,
  ringHaloPx: 4,
  ringHaloAlpha: 0.9,
  ringLinePx: 2,
  maxDpr: 2
} as const;

export function policyColour(dark: boolean): string {
  return TOKENS[dark ? 'dark' : 'light']['tl-halo-policy'];
}

export function dropRadius(worth: number): number {
  return Math.min(DRAW.dropMaxPx, DRAW.dropMinPx + DRAW.dropPerSqrtPx * Math.sqrt(worth));
}

function circlePath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.arc(x, y, s, 0, Math.PI * 2);
}

function diamondPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + s, y);
  ctx.lineTo(x, y + s);
  ctx.lineTo(x - s, y);
  ctx.closePath();
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function drawDrop(
  ctx: CanvasRenderingContext2D,
  l: LiveDrop,
  now: number,
  look: Look,
  reduced: boolean
): void {
  const at = l.at;
  if (at === null) return;
  const policy = l.drop.policy;
  let s = dropRadius(l.worth) * (policy ? DRAW.diamondScale : 1);
  let alpha = 1;
  const taken = l.takenMs !== null;
  if (taken) {
    if (!reduced) {
      const p = clamp01((now - (l.takenMs as number)) / RUN_TIMES.takenMs);
      s *= 1 + DRAW.takenGrow * p;
      alpha = DRAW.takenAlpha * (1 - p);
    }
  } else if (!reduced) {
    const u = 1 - clamp01((now - l.bornMs) / RUN_TIMES.appearMs);
    s *= 1 - u * u * u;
    const left = l.endMs - now;
    if (left < RUN_TIMES.fadeMs) alpha = left <= 0 ? 0 : left / RUN_TIMES.fadeMs;
  }
  ctx.globalAlpha = alpha;
  if (policy) diamondPath(ctx, at.x, at.y, s);
  else circlePath(ctx, at.x, at.y, s);
  const colour = policy ? look.policy : look.accent;
  if (taken) {
    ctx.lineWidth = DRAW.takenLinePx;
    ctx.strokeStyle = colour;
    ctx.stroke();
  } else {
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.lineWidth = DRAW.outlinePx;
    ctx.strokeStyle = look.surface;
    ctx.stroke();
  }
}

function drawCount(
  ctx: CanvasRenderingContext2D,
  c: FloatCount,
  now: number,
  look: Look,
  reduced: boolean
): void {
  let rise = 0;
  let alpha = 1;
  if (!reduced) {
    const p = clamp01((now - c.bornMs) / RUN_TIMES.countMs);
    rise = DRAW.countRisePx * p;
    if (p > DRAW.countHoldShare) alpha = 1 - (p - DRAW.countHoldShare) / (1 - DRAW.countHoldShare);
  }
  const top = dropRadius(c.worth) * (c.policy ? DRAW.diamondScale : 1);
  const y = c.y - top - DRAW.countGapPx - rise;
  const text = dropCountText(c.worth);
  ctx.globalAlpha = alpha;
  ctx.lineWidth = DRAW.countHaloPx;
  ctx.strokeStyle = look.surface;
  ctx.strokeText(text, c.x, y);
  ctx.fillStyle = look.ink;
  ctx.fillText(text, c.x, y);
}

export function drawRun(
  ctx: CanvasRenderingContext2D,
  m: RunModel,
  o: { now: number; look: Look; reduced: boolean; radiusPx: number; showRing: boolean }
): void {
  const { now, look, reduced } = o;
  ctx.clearRect(0, 0, m.box.w, m.box.h);
  ctx.save();
  ctx.lineJoin = 'round';

  let first = m.live.length;
  for (let n = 0, i = m.live.length - 1; i >= 0; i--) {
    if (m.live[i].at === null) continue;
    first = i;
    if (++n >= RUN_CAPS.maxDrawn) break;
  }
  for (let i = first; i < m.live.length; i++) drawDrop(ctx, m.live[i], now, look, reduced);

  if (m.counts.length > 0) {
    ctx.font = `${DRAW.countWeight} ${DRAW.countFontPx}px ${look.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (let i = 0; i < m.counts.length; i++) drawCount(ctx, m.counts[i], now, look, reduced);
  }

  if (o.showRing) {
    circlePath(ctx, m.ring.x, m.ring.y, o.radiusPx);
    ctx.globalAlpha = DRAW.ringFillAlpha;
    ctx.fillStyle = look.accent;
    ctx.fill();
    ctx.globalAlpha = DRAW.ringHaloAlpha;
    ctx.lineWidth = DRAW.ringHaloPx;
    ctx.strokeStyle = look.surface;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.lineWidth = DRAW.ringLinePx;
    ctx.strokeStyle = look.ink;
    ctx.stroke();
  }
  ctx.restore();
}
