// Calibration report section 14 (car ownership): the choice model's part (the fitted
// coefficients with standard errors, the published priors beside them, the fit by block group and
// citywide, the DMV cross-check) and the rest of the model (move rates, refill and new-home mixes,
// spaces per new home, cost per space). Pure.
import type { CarData } from '../../../src/lib/data/cars-codec';
import {
  CAR_LEVELS,
  MIXES,
  carShares,
  densityOf,
  meanCars,
  type CarModel,
  type Mix
} from '../../../src/lib/sim/cars';
import { num } from '../fzp-cal/report';
import type { BgFit, CarChoiceModel, FitStats, FitTerm } from './fit';
import { PRIORS, PRIOR_PROVENANCE } from './priors';
import {
  COST_CROSS_CHECK,
  MIN_CELL_RECORDS,
  type MoveStats,
  type NewHomeStats,
  type ParkingStats
} from './rates';

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
  const c = s.constants;
  const afterErr0 = seen.map((f) => Math.abs(f.after[0] - obsShare(f, 0)));
  const afterMax = seen.map((f) =>
    Math.max(...f.after.map((p, k) => Math.abs(p - obsShare(f, k))))
  );
  const afterMae0 = afterErr0.reduce((a, b) => a + b, 0) / Math.max(1, afterErr0.length);
  const rng = (r: [number, number]) => `${f4(r[0])} to ${f4(r[1])}`;
  lines.push(
    c.n0 === null
      ? 'Shrinkage: B25044 shows no dispersion beyond binomial around the model, so each block ' +
          "group's target is the model's shares (constants 0)."
      : `Shrinkage: each block group's B25044 shares are pulled toward the model's (empirical ` +
          `Bayes, share* = (n obs + n0 pred) / (n + n0)) with n0 = ${f4(c.n0)}, by the method of ` +
          'moments on the dispersion of observed against predicted shares beyond sampling ' +
          'variance. An observed zero level keeps a nonzero share.',
    c.sizes.fromMoe
      ? `n is each block group's effective sample size from its B25044 margins of error ` +
          '(n_eff = sum p(1-p) / sum SE(p)^2 over the four levels, SE = MOE / 1.645; a ' +
          "level's MOE is the Census rule for a sum: every nonzero cell's MOE in quadrature " +
          "plus only the largest MOE among its zero-estimate cells, per the Census Bureau's " +
          '"Understanding and Using American Community Survey Data" (2020), ch. 8): median ' +
          `${f4(c.sizes.median)} against a median ${f4(c.sizes.householdsMedian)} estimated ` +
          `households; ${c.sizes.missing} block groups had no margins and take their estimated ` +
          'households.'
      : "n is each block group's estimated households: the lock has no B25044 margins of " +
          'error, so the shrinkage is too weak (ACS samples a fraction of households).',
    `Constants: ${c.fitted} block groups fitted to the shrunk shares (largest difference ` +
      `${c.maxErr.toExponential(1)}), range ${rng(c.range)}; fitted to the raw B25044 shares ` +
      `instead (an observed zero held at 1e-9) they would range ${rng(c.rawRange)}. ` +
      `${c.noObservation} block groups have no B25044 households (constants 0), ${c.cityMix} ` +
      `no start household (the citywide type mix stands in); ${c.observedZero} observed-zero ` +
      'shares.'
  );
  if (seen.length > 0)
    lines.push(
      `After the constants, against the raw B25044 shares: zero-car share error median ` +
        `${pts(quantile(afterErr0, 0.5))} points, 90th percentile ` +
        `${pts(quantile(afterErr0, 0.9))} points, mean ${pts(afterMae0)} points; largest error ` +
        `at any level median ${pts(quantile(afterMax, 0.5))} points, 90th percentile ` +
        `${pts(quantile(afterMax, 0.9))} points.`
    );
  const worst = seen
    .map((f, i) => ({ f, e: afterErr0[i] }))
    .sort((a, b) => b.e - a.e || (a.f.geoid < b.f.geoid ? -1 : 1))
    .slice(0, WORST_ZONES);
  if (worst.length > 0)
    lines.push(
      '',
      `Largest zero-car errors after the constants (${worst.length}):`,
      '',
      '| Block group | Start households | B25044 households | B25044 no car | Before | After |',
      '|---|---|---|---|---|---|',
      ...worst.map(
        ({ f }) =>
          `| ${f.geoid} | ${f.households} | ${Math.round(f.observedTotal)} | ` +
          `${pct(obsShare(f, 0))} | ${pct(f.before[0])} | ${pct(f.after[0])} |`
      )
    );

  // The start population against the model at month 0: its zone shares by level.
  {
    const Zs = data.zones.length;
    const cellsS = data.types * CAR_LEVELS;
    const gap0: number[] = [];
    let weighted = 0;
    let weight = 0;
    let worst = { gap: 0, n: 0 };
    for (let z = 0; z < Zs; z++) {
      const f = fit.fit[z];
      const lv = [0, 0, 0, 0];
      for (let i = 0; i < cellsS; i++) lv[i % CAR_LEVELS] += data.households[z * cellsS + i];
      const n = lv.reduce((a, b) => a + b, 0);
      if (!f || !(f.observedTotal > 0) || n === 0) continue;
      const g = Math.abs(lv[0] / n - f.after[0]);
      gap0.push(g);
      weighted += n * g;
      weight += n;
      for (let k = 0; k < CAR_LEVELS; k++) {
        const gk = Math.abs(lv[k] / n - f.after[k]);
        if (gk > worst.gap) worst = { gap: gk, n };
      }
    }
    if (gap0.length > 0)
      lines.push(
        '',
        "Start population: each block group's households are raked to share* as the vehicle " +
          'margin (B25009 tenure by size and B19001 income as before), so at month 0 they hold ' +
          "the model's shares up to rounding: zero-car gap median " +
          `${pts(quantile(gap0, 0.5))} points, 90th percentile ${pts(quantile(gap0, 0.9))} ` +
          `points, households-weighted mean ${pts(weighted / weight)} points; the largest gap ` +
          `at any level, ${pts(worst.gap)} points, is in a block group of ${worst.n} ` +
          `household${worst.n === 1 ? '' : 's'} (one household moves a share by 1/n).`
      );
  }

  // Citywide shares and cars, from the model with the constants.
  const Z = data.zones.length;
  const T = data.types;
  const cells = T * CAR_LEVELS;
  const out = new Float64Array(CAR_LEVELS);
  const simLevels = new Float64Array(CAR_LEVELS);
  const acsWeighted = new Float64Array(CAR_LEVELS);
  const acsLevels = new Float64Array(CAR_LEVELS);
  const startLevels = new Float64Array(CAR_LEVELS);
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
      for (let k = 0; k < CAR_LEVELS; k++) {
        simLevels[k] += nt * out[k];
        startLevels[k] += data.households[z * cells + t * CAR_LEVELS + k];
      }
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
    '| Cars | Start households | Model, start households | Model, B25044 households | ACS B25044 |',
    '|---|---|---|---|---|',
    ...label.map(
      (l, k) =>
        `| ${l} | ${pct(startLevels[k] / simHh)} | ${pct(simLevels[k] / simHh)} | ` +
        `${pct(acsWeighted[k] / acsHh)} | ` +
        `${pct(acsLevels[k] / acsHh)} |`
    ),
    '',
    `Households: ${simHh} start households (assessor homes times the occupied share) against ` +
      `${Math.round(acsHh)} in B25044; shares are compared, not totals. The start households ` +
      "hold the model's shares (first two columns, up to rounding). The model columns are the " +
      'same model and constants: they differ only in where the assessor homes (times the ' +
      'occupied share) sit against where ACS counts households. The last two differ by the ' +
      'shrinkage.'
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
      : 'DMV: no registrations in the lock; no cross-check.'
  );
  return lines;
}

/**
 * Predicted spaces per new home for a type mix: per zone, supplyOverUse x mean cars of the mix at
 * the zone's start density (the choice with its constants, `meanCars` with the 3+ mean); citywide,
 * the zones' mean weighted by start households. Zones with no household are left out.
 */
export function spacesPerNewHome(
  model: CarModel,
  data: CarData,
  mix: readonly number[]
): { city: number; zones: number[] } {
  const T = data.types;
  const cells = T * CAR_LEVELS;
  const out = new Float64Array(CAR_LEVELS);
  const zones: number[] = [];
  let sum = 0;
  let weight = 0;
  for (let z = 0; z < data.zones.length; z++) {
    let n = 0;
    for (let i = 0; i < cells; i++) n += data.households[z * cells + i];
    if (n === 0) continue;
    const density = densityOf(n, data.areaM2[z]);
    let cars = 0;
    for (let t = 0; t < T; t++) {
      if (mix[t] === 0) continue;
      carShares(model, data, z, t, density, out);
      cars += mix[t] * meanCars(out, model.threePlusMean);
    }
    const spaces = cars * model.parking.supplyOverUse;
    zones.push(spaces);
    sum += n * spaces;
    weight += n;
  }
  return { city: weight > 0 ? sum / weight : 0, zones };
}

const MIX_LABEL: Record<Mix, string> = {
  market: 'Market',
  veryLow: 'Very low income',
  low: 'Low income',
  moderate: 'Moderate income'
};
const usd = (x: number) => `$${Math.round(x).toLocaleString('en-US')}`;
const pctMonth = (x: number) => `${(100 * x).toFixed(3)}%`;

/** Section 14's lines for moves, new homes and parking: the model beyond the choice. */
export function carsModelReportLines(
  model: CarModel,
  data: CarData,
  s: { moves: MoveStats; newHomes: NewHomeStats; parking: ParkingStats; pumas: string[] }
): string[] {
  const T = data.types;
  const m = s.moves;
  const nh = s.newHomes;
  const pk = s.parking;
  const [from, to] = model.moves.provenance.window ?? ['', ''];
  const tenureLine = (label: string, r: MoveStats['tenure']['owner']) =>
    `${label} ${pct(r.annual)} a year (${pctMonth(r.perMonth)} a month, ${r.records} records)`;
  const lines: string[] = [
    '',
    '### Moves',
    '',
    `Move rates from PUMS ${from.slice(0, 4)}-${to.slice(0, 4)} households by when they moved ` +
      `in (MV 1, within 12 months), ${m.records} records` +
      (m.noMv > 0 ? ` (${m.noMv} without MV left out)` : '') +
      `: ${tenureLine('owners', m.tenure.owner)}; ${tenureLine('renters', m.tenure.renter)}. ` +
      `Monthly = 1 - (1 - annual)^(1/12). ${T - m.fallback} of ${T} types have their own rate ` +
      `(at least ${MIN_CELL_RECORDS} records); ${m.fallback} take their tenure's. Monthly ` +
      `rates range ${pctMonth(m.perMonthRange[0])} to ${pctMonth(m.perMonthRange[1])}.`,
    "Refill: an out-mover's home takes a household drawn from its PUMA's movers mix (type " +
      'shares of households with MV 1). Mover records by PUMA: ' +
      s.pumas.map((p, i) => `${p} ${m.moversByPuma[i]}`).join(', ') +
      '.' +
      (m.pumaFallback.length > 0
        ? ` ${m.pumaFallback.join(', ')} had none and take the citywide movers' mix.`
        : '')
  ];

  // New homes.
  const renters = (mix: readonly number[]) => mix.reduce((a, x, t) => (t % 2 === 1 ? a + x : a), 0);
  const spaces = Object.fromEntries(
    MIXES.map((k) => [k, spacesPerNewHome(model, data, model.newHomes.mix[k])])
  ) as Record<Mix, { city: number; zones: number[] }>;
  const tiers = model.newHomes.affordableTiers;
  lines.push(
    '',
    '### New homes',
    '',
    `A new home's household type is drawn from PUMS ${nh.release} households that moved in ` +
      `within 12 months into homes built from ${nh.builtFrom} (the latest built-year code at or ` +
      `before ${nh.release} - 10). Affordable homes take the same households at incomes at or ` +
      `below their tier's limit (50%, 80% or 120% of SF AMI ${nh.amiYear} for the household's ` +
      'size, MOHCD).' +
      (nh.allHomes.length > 0
        ? ` ${nh.allHomes.map((k) => MIX_LABEL[k]).join(', ')}: no new-home record, so movers ` +
          'into homes of any age.'
        : ''),
    '',
    '| Mix | Records | Households | Renters | Spaces per new home |',
    '|---|---|---|---|---|',
    ...MIXES.map(
      (k) =>
        `| ${MIX_LABEL[k]} | ${nh.records[k]} | ${Math.round(nh.households[k])} | ` +
        `${pct(renters(model.newHomes.mix[k]))} | ${f4(spaces[k].city)} |`
    ),
    '',
    `Affordable homes by tier: very low ${pct(tiers.veryLow)}, low ${pct(tiers.low)}, moderate ` +
      `${pct(tiers.moderate)}` +
      (nh.tiersFrom === 'projects'
        ? ' (net affordable completions since the RHNA window opened, projects.json: ' +
          `${nh.byTier.veryLow}, ${nh.byTier.low}, ${nh.byTier.moderate}).`
        : ". The dataset's affordable completions by tier sum to 0, so these are the PUMS " +
          'new-home movers at or below the moderate limit, split by tier.')
  );

  // Parking.
  const market = spaces.market;
  lines.push(
    '',
    '### Parking in new buildings',
    '',
    'Spaces per new home = predicted cars per household of the new-home mix (the choice and the ' +
      `zone's constants at its density) x ${f4(pk.supply.value)} spaces built per space used ` +
      `(tier ${pk.supply.tier}: ${pk.supply.sources.join('; ')}).`,
    market.zones.length > 0
      ? `Market mix today: ${f4(market.city)} spaces per new home citywide (start-households ` +
          `weighted); by block group median ${f4(quantile(market.zones, 0.5))}, 10th to 90th ` +
          `percentile ${f4(quantile(market.zones, 0.1))} to ${f4(quantile(market.zones, 0.9))}.`
      : 'Market mix today: no block group has a start household; no spaces per new home.',
    "Baseline: each lot's reference is the spaces per home the model predicts for it at the " +
      "window's start (today's households, today's transit). Today's starts are post-2018, " +
      'built to demand, so predicted demand (not the old minimums, nor the parking the ' +
      'Controller prototypes assume) is the reference; only change from today moves start odds.'
  );
  if (pk.costs === null) {
    lines.push(
      '',
      'The parking link is off: no cited San Francisco cost per space was found. The model ' +
        'still predicts spaces per home. Searched:',
      '',
      ...pk.searched.map((x) => `- ${x}`)
    );
    return lines;
  }
  const [lo, hi] = COST_CROSS_CHECK.perGsf;
  const gsf = COST_CROSS_CHECK.gsfPerSpace;
  const below = pk.costs.find((c) => c.type === 'belowGrade');
  lines.push(
    '',
    `Cost per space (hard cost, cited SF figures), in ${pk.commonYear} dollars, the finance ` +
      "prototypes' (Controller 2026), since the odds shift divides it by their cost per home: " +
      `cost x I(${pk.commonYear}) / I(y) x CPI(${pk.commonYear}) / CPI(y), y the source's ` +
      "dollars year. I is the Controller's Blended Construction Cost Index (market.json, " +
      `inflation-adjusted, held at ${pk.indexLast} after its last year): the real change in ` +
      `construction cost. CPI is BLS CPI-U San Francisco-Oakland-Hayward, all items, annual ` +
      `average (${pk.cpiSeries}, cpi.json): the price level.` +
      (pk.cpiYear !== null && pk.cpiYear < (pk.commonYear ?? 0)
        ? ` The ${pk.commonYear} annual average is not yet published, so ${pk.cpiYear}'s stands ` +
          `in for CPI(${pk.commonYear}).`
        : ''),
    '',
    `| Type | Cited | Dollars year | Cost index ratio | CPI ratio | ${pk.commonYear} dollars | ` +
      'Source |',
    '|---|---|---|---|---|---|---|',
    ...pk.costs.map(
      (c) =>
        `| ${c.type} | ${usd(c.value)} | ${c.dollarsYear} | ${c.factor.toFixed(4)} | ` +
        `${c.cpiFactor.toFixed(4)} | ${usd(c.escalated)} | ${c.sources.join('; ')} |`
    ),
    ...pk.unpriced.map((t) => `| ${t} | none | none | none | none | none | no SF source found |`),
    ''
  );
  if (pk.unpriced.length > 0)
    lines.push(
      `${pk.unpriced.join(', ')}: no cited SF cost per space, so projects built with that ` +
        'parking get no parking cost (zero shift).'
    );
  lines.push(
    `Cross-check, not used: the Controller's ${COST_CROSS_CHECK.year} parking hard cost of ` +
      `${usd(lo)} to ${usd(hi)} per gross square foot times about ${gsf} square feet per space ` +
      `gives ${usd(lo * gsf)} to ${usd(hi * gsf)} per below-grade space in ` +
      `${COST_CROSS_CHECK.year} dollars (docs/dev/cars-data.md)` +
      (below ? `, beside the cited figure's ${usd(below.escalated)}.` : '.')
  );
  return lines;
}
