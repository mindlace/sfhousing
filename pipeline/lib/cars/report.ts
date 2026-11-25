// Calibration report section 14 (car ownership), the choice model's part: the fitted coefficients
// with standard errors, the published priors beside them, the fit by block group and citywide,
// the DMV cross-check and today's predicted spaces per new home. Pure.
import type { CarData } from '../../../src/lib/data/cars-codec';
import { CAR_LEVELS, carShares, densityOf, meanCars } from '../../../src/lib/sim/cars';
import { num } from '../fzp-cal/report';
import type { BgFit, CarChoiceModel, FitStats, FitTerm } from './fit';
import { PRIORS, PRIOR_PROVENANCE } from './priors';

/** Worst block groups listed by their zero-car error before the constants. */
export const WORST_ZONES = 10;

const f4 = (x: number) => num(Number(x.toPrecision(4)));
const pts = (x: number) => (100 * x).toFixed(2);
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

/** Nearest-rank quantile of a non-empty list. */
function quantile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(p * s.length) - 1)];
}

function termRows(terms: FitTerm[]): string[] {
  return terms.map((t) =>
    t.dropped
      ? `| ${t.name} | dropped | dropped | dropped |`
      : `| ${t.name} | ${[0, 1, 2].map((k) => `${f4(t.coef[k])} (±${f4(t.se[k])})`).join(' | ')} |`
  );
}

export function carsReportLines(
  model: CarChoiceModel,
  data: CarData,
  fit: { fit: BgFit[]; stats: FitStats },
  dmv: { year: number; lightDuty: number } | null
): string[] {
  const s = fit.stats;
  const head = '| Term | 1 car | 2 cars | 3+ cars |';
  const rule = '|---|---|---|---|';
  const lines: string[] = [
    '',
    '### Choice model',
    '',
    'A multinomial logit over 0, 1, 2 and 3+ cars per household (0 the base), in the structure ' +
      "of MTC Travel Model Two and ActivitySim's auto_ownership, refitted to SF data " +
      `(provenance tier ${model.choice.provenance.tier}: ${model.choice.provenance.label}).`,
    `Stage 1, household terms: ${s.stage1.records} PUMS households (weights WGTP) with the ` +
      `PUMA's mean density and access; log-likelihood ${f4(s.stage1.logLik)}, ` +
      `${s.stage1.iterations} Newton iterations.`,
    `Stage 2, location terms: household terms fixed, the start households of ${s.stage2.zones} ` +
      `block groups; log-likelihood ${f4(s.stage2.logLik)}, ${s.stage2.iterations} iterations.`,
    `Standard errors are stated at the PUMS sample size (${s.stage1.records} records); stage 2's ` +
      'are indicative only (its shares are B25044 block-group estimates). A dropped term is ' +
      'one the data cannot identify (no variation, or fewer than 3 PUMAs or peopled block ' +
      'groups): its coefficient is 0.',
    'Density is start households per hectare of land (TIGER ALAND); access is the transit ' +
      "grid's value, homes-weighted over each block group's lots.",
    '',
    'Stage 1 (PUMS):',
    '',
    head,
    rule,
    ...termRows(s.stage1.terms),
    '',
    'Stage 2 (block groups; the model keeps these and the stage 1 household terms):',
    '',
    head,
    rule,
    ...termRows(s.stage2.terms),
    '',
    `### Priors: ${PRIOR_PROVENANCE.label}, tier ${PRIOR_PROVENANCE.tier}`,
    '',
    'Published coefficients, as the starting point and the cross-check (spec "Choice model"). ' +
      'MTC Travel Model Two is a nested logit with drivers, not household size, and ' +
      'zone accessibility logsums; ActivitySim (prototype_mtc) is an MNL on drivers, workers, ' +
      'piecewise income and a density index. Neither shares our units, so compare signs and ' +
      'the ordering across levels, not magnitudes.',
    '',
    '| Model | Term | Definition | 1 car | 2 cars | 3 cars |',
    '|---|---|---|---|---|---|',
    ...PRIORS.map(
      (p) => `| ${p.model} | ${p.term} | ${p.definition} | ${p.coef.map(f4).join(' | ')} |`
    ),
    '',
    `Sources: ${PRIOR_PROVENANCE.sources.map((x) => `${x.label} (${x.url})`).join('; ')}. ` +
      PRIOR_PROVENANCE.method,
    '',
    '### Transit access measure',
    '',
    `The grid measure raises stage 2's log-likelihood by ` +
      `${f4(s.stage2.logLik - s.stage2.logLikNoAccess)} over density alone ` +
      `(${f4(s.stage2.logLikNoAccess)} without access). No jobs-reachable measure can be built ` +
      'from the lock (it has no jobs-by-location source), so the comparison the spec allows was ' +
      'not made and the grid stays.'
  ];

  // Fit by block group.
  const seen = fit.fit.filter((f) => f.observedTotal > 0);
  const obsShare = (f: BgFit, k: number) => f.observed[k] / f.observedTotal;
  const err0 = seen.map((f) => Math.abs(f.before[0] - obsShare(f, 0)));
  const errMax = seen.map((f) => Math.max(...f.before.map((p, k) => Math.abs(p - obsShare(f, k)))));
  const mae0 = err0.reduce((a, b) => a + b, 0) / Math.max(1, err0.length);
  lines.push('', '### Fit by block group', '');
  if (seen.length > 0)
    lines.push(
      `Before the zone constants (the across-zone terms alone), over ${seen.length} block ` +
        `groups with B25044 households: zero-car share error median ${pts(quantile(err0, 0.5))} ` +
        `points, 90th percentile ${pts(quantile(err0, 0.9))} points, mean ${pts(mae0)} points; ` +
        `largest error at any level median ${pts(quantile(errMax, 0.5))} points, 90th ` +
        `percentile ${pts(quantile(errMax, 0.9))} points.`
    );
  lines.push(
    `After the constants every block group's 0/1/2/3+ shares equal B25044's (largest ` +
      `difference ${s.constants.maxErr.toExponential(1)}). Constants: ${s.constants.fitted} ` +
      `block groups fitted, ${s.constants.noObservation} with no B25044 households (constants ` +
      `0), ${s.constants.cityMix} with no start household (the citywide type mix stands in), ` +
      `${s.constants.floored} observed-zero shares held at 1e-9.`
  );
  const worst = seen
    .map((f, i) => ({ f, e: err0[i] }))
    .sort((a, b) => b.e - a.e || (a.f.geoid < b.f.geoid ? -1 : 1))
    .slice(0, WORST_ZONES);
  if (worst.length > 0)
    lines.push(
      '',
      `Largest zero-car errors before the constants (${worst.length}):`,
      '',
      '| Block group | Start households | B25044 households | B25044 no car | Predicted before |',
      '|---|---|---|---|---|',
      ...worst.map(
        ({ f }) =>
          `| ${f.geoid} | ${f.households} | ${Math.round(f.observedTotal)} | ` +
          `${pct(obsShare(f, 0))} | ${pct(f.before[0])} |`
      )
    );

  // Citywide shares and cars, from the model with the constants.
  const Z = data.zones.length;
  const T = data.types;
  const cells = T * CAR_LEVELS;
  const out = new Float64Array(CAR_LEVELS);
  const simLevels = new Float64Array(CAR_LEVELS);
  const acsWeighted = new Float64Array(CAR_LEVELS);
  const acsLevels = new Float64Array(CAR_LEVELS);
  let simHh = 0;
  let acsHh = 0;
  let cars = 0;
  const m = model as Parameters<typeof carShares>[0];
  for (let z = 0; z < Z; z++) {
    let n = 0;
    for (let i = 0; i < cells; i++) n += data.households[z * cells + i];
    const density = densityOf(n, data.areaM2[z]);
    for (let t = 0; t < T; t++) {
      let nt = 0;
      for (let k = 0; k < CAR_LEVELS; k++) nt += data.households[z * cells + t * CAR_LEVELS + k];
      if (nt === 0) continue;
      carShares(m, data, z, t, density, out);
      for (let k = 0; k < CAR_LEVELS; k++) simLevels[k] += nt * out[k];
      cars += nt * meanCars(out, model.threePlusMean);
    }
    simHh += n;
    const f = fit.fit[z];
    if (f && f.observedTotal > 0) {
      for (let k = 0; k < CAR_LEVELS; k++) {
        acsWeighted[k] += f.observedTotal * f.after[k];
        acsLevels[k] += f.observed[k];
      }
      acsHh += f.observedTotal;
    }
  }
  const label = ['0', '1', '2', '3+'];
  lines.push(
    '',
    '### Citywide',
    '',
    '| Cars | Model, start households | Model, B25044 households | ACS B25044 |',
    '|---|---|---|---|',
    ...label.map(
      (l, k) =>
        `| ${l} | ${pct(simLevels[k] / simHh)} | ${pct(acsWeighted[k] / acsHh)} | ` +
        `${pct(acsLevels[k] / acsHh)} |`
    ),
    '',
    `Households: ${simHh} start households (assessor homes times the occupied share) against ` +
      `${Math.round(acsHh)} in B25044; shares are compared, not totals. With each block group's ` +
      'shares matched, a citywide difference comes only from where the start households sit ' +
      'against where B25044 counts them.'
  );

  // Cross-checks.
  const perHh = cars / simHh;
  lines.push(
    '',
    '### Cross-checks',
    '',
    `Cars: the model gives ${Math.round(cars)} household cars (3+ households at ` +
      `${f4(model.threePlusMean)}, the PUMS mean), ${f4(perHh)} per household.`,
    dmv
      ? `DMV: ${dmv.lightDuty} light-duty vehicles registered in SF ZIPs (941xx) as of 1/1/` +
          `${dmv.year}, ${f4(dmv.lightDuty / cars)} times the model's cars; DMV counts business ` +
          'and non-household registrations too. Cross-check only.'
      : 'DMV: no registrations in the lock; no cross-check.',
    model.parking
      ? `Today: ${f4(perHh)} predicted cars per household (the start households' mix) times ` +
          `${f4(model.parking.supplyOverUse)} spaces built per space used gives ` +
          `${f4(perHh * model.parking.supplyOverUse)} spaces per new home citywide (the ` +
          "new-home mix replaces today's households' mix once it is fitted)."
      : 'Spaces per new home: no parking facts (supply over use), not computed.'
  );
  return lines;
}
