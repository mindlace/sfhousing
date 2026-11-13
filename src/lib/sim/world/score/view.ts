import { targetsOf, tierTargetsOf } from '$lib/sim/scenario/score';
import type { PlanRow, ScoreStatics, SeriesChunk, TimelineView } from './types';

/** z of the 80% central band (10th to 90th percentile), as today's `band`. */
export const BAND_Z = 1.2816;

function bandOf(m: PlanRow, sd: PlanRow): { lo: PlanRow; hi: PlanRow } {
  return {
    lo: {
      entitledNew: m.entitledNew - BAND_Z * sd.entitledNew,
      completedNetNew: m.completedNetNew - BAND_Z * sd.completedNetNew
    },
    hi: {
      entitledNew: m.entitledNew + BAND_Z * sd.entitledNew,
      completedNetNew: m.completedNetNew + BAND_Z * sd.completedNetNew
    }
  };
}

/** Joins contiguous chunks into what the page reads. Throws on a gap, an overlap or a late start. */
export function viewOf(chunks: SeriesChunk[], statics: ScoreStatics): TimelineView {
  const mean: TimelineView['mean'] = [];
  const band: TimelineView['band'] = [];
  const shown: TimelineView['shown'] = [];
  const planEffect: TimelineView['planEffect'] = [];
  const planEffectBand: TimelineView['planEffectBand'] = [];
  const tiers: NonNullable<TimelineView['tiers']> = [];
  let hasTiers = chunks.length > 0;
  for (const c of chunks) {
    if (c.from !== mean.length) {
      throw new Error(`chunk from ${c.from} does not follow ${mean.length - 1}`);
    }
    for (let i = 0; i < c.mean.length; i++) {
      const m = c.mean[i].completedNet;
      const sd = c.sd[i].completedNet;
      mean.push(c.mean[i]);
      band.push({ lo: m - BAND_Z * sd, hi: m + BAND_Z * sd });
      shown.push(c.shown[i]);
      planEffect.push(c.planEffect[i].mean);
      planEffectBand.push(bandOf(c.planEffect[i].mean, c.planEffect[i].sd));
    }
    if (c.tiers) tiers.push(...c.tiers);
    else hasTiers = false;
  }
  const { units, since, provenance } = statics.baseline;
  const tierSeries = hasTiers ? tiers : null;
  return {
    months: statics.months,
    lastIndex: statics.lastIndex,
    filledThrough: mean.length - 1,
    mean,
    band,
    shown,
    planEffect,
    planEffectBand,
    targets: targetsOf(units, mean),
    tierTargets:
      statics.tierBaseline && tierSeries ? tierTargetsOf(statics.tierBaseline, tierSeries) : null,
    money: null,
    tiers: tierSeries,
    baseline: { completedNet: units, since, provenance },
    phasing: statics.phasing,
    references: statics.references,
    compare: statics.compare
  };
}

/** The chunks' months before `k`: whole chunks kept, the one straddling `k` trimmed (rule 13). */
export function chunksBefore(chunks: SeriesChunk[], k: number): SeriesChunk[] {
  const out: SeriesChunk[] = [];
  for (const c of chunks) {
    if (c.from >= k) break;
    const n = k - c.from;
    if (n >= c.mean.length) {
      out.push(c);
      continue;
    }
    out.push({
      from: c.from,
      mean: c.mean.slice(0, n),
      sd: c.sd.slice(0, n),
      shown: c.shown.slice(0, n),
      planEffect: c.planEffect.slice(0, n),
      money: c.money && c.money.slice(0, n),
      tiers: c.tiers && c.tiers.slice(0, n)
    });
  }
  return out;
}
