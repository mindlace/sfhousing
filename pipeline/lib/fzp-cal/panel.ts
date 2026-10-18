/**
 * The initiation model's panel (stage-calibration spec §4.6): the at-risk timeline from the
 * qualifying histories with each event's detection basis, aggregation of the T13 parcel panel
 * (`scenario_panel`) into fit cells, and the imputed-mask counts. Features are read, never
 * computed or altered here.
 */
import type { Duck } from '../duck';
import { isoToDay } from '../../project-records/multiphase';
import type { ParcelId } from '../../../src/lib/data/parcel';
import { binIndex } from '../../../src/lib/timelapse/model';
import type { Day, FeatureId } from '../../../src/lib/timelapse/types';
import { PLANNING_START } from './window';
import { CalibrationError, type NormHistory, type PermitRow } from './types';

/** Calendar months 2007-01 .. 2025-12. */
export const PANEL_MONTHS = 228;
const FIRST_YEAR = 2007;
const LAST_YEAR = 2025;
/** Month index of 2015-01, the Planning-side start: earlier non-event months take basis 1. */
const RECORD_MONTH = (2015 - FIRST_YEAR) * 12;
const RECORD_DAY = isoToDay(PLANNING_START);
const MASK_BITS = 7;

/** The order of `FitCell.bins`: the spec §4.6 feature table. */
export const PANEL_FEATURES: readonly FeatureId[] = [
  'potentialRatio',
  'existingUnits',
  'lotAreaM2',
  'yearBuilt',
  'storiesGap',
  'improvementShare',
  'rentControlLikely',
  'landUseClass'
];

/** Timeline values. */
const COVERED = -1;
const EVENT_RECORD = 1;
const EVENT_PERMIT = 2;

/** The calendar month of a UTC day minus 2007-01; may fall outside 0..PANEL_MONTHS-1. */
export function monthIndex(d: Day): number {
  const t = new Date(d * 86_400_000);
  return (t.getUTCFullYear() - FIRST_YEAR) * 12 + t.getUTCMonth();
}

/** One `scenario_panel` row of one roll year, features mapped per the §4.6 table. */
export interface PanelYearRow {
  mapblklot: string;
  hostableBase: boolean;
  imputed: number;
  features: Record<FeatureId, number>;
}

export type PanelSource = {
  years: number[];
  /** that roll year's rows, sorted by mapblklot */
  read(rollYear: number): Promise<PanelYearRow[]>;
};

export interface InitiationEvents {
  /** per parcel, PANEL_MONTHS values: -1 not at risk, 0 at risk, 1 event basis record, 2 event basis permit */
  timeline: Map<ParcelId, Int8Array>;
  /** F before 2015 and no permit filing: invisible, no event and no coverage */
  noPermit: number;
  /** no parcel to place the event or coverage on */
  noParcel: number;
  /** no raw preApplication, filed or permitFiled day: no F */
  noStart: number;
  /** event month outside 2007-01 .. 2025-12: no panel event (coverage still applies) */
  outOfRange: number;
  /** event on a parcel-month another history already covers (or already has an event): not counted */
  eventsCovered: number;
}

/** The raw first new-construction permit filing day P per project id (all rows, superseded too). */
export function firstFiledDays(permits: PermitRow[]): Map<string, Day> {
  const out = new Map<string, Day>();
  for (const p of permits) {
    if (p.project_id === null || p.filed_day === null) continue;
    const cur = out.get(p.project_id);
    if (cur === undefined || p.filed_day < cur) out.set(p.project_id, p.filed_day);
  }
  return out;
}

/** F: the earliest raw `entered` day of preApplication, filed and permitFiled. */
function firstEntered(h: NormHistory): Day | undefined {
  let f: Day | undefined;
  for (const s of ['preApplication', 'filed', 'permitFiled'] as const) {
    const v = h.src.entered[s];
    if (v !== undefined && (f === undefined || v < f)) f = v;
  }
  return f;
}

/** The largest lot, ties to the smaller id (a NaN area counts as the smallest). */
function primaryParcel(ids: ParcelId[], lotArea: (id: ParcelId) => number): ParcelId {
  let best = ids[0];
  let bestArea = lotArea(best);
  if (Number.isNaN(bestArea)) bestArea = -Infinity;
  for (let i = 1; i < ids.length; i++) {
    const a0 = lotArea(ids[i]);
    const a = Number.isNaN(a0) ? -Infinity : a0;
    if (a > bestArea || (a === bestArea && ids[i] < best)) {
      best = ids[i];
      bestArea = a;
    }
  }
  return best;
}

/**
 * The at-risk timeline (spec §4.6 "Detection basis", "Event", "At risk"). Coverage of every
 * history is laid down first, then events in id order, so the result does not depend on the
 * input order. Coverage runs from the event month + 1 (month 0 for a pre-panel P) through the
 * exit month (exit), or through the panel end (complete; open, purge-censored included).
 */
export function initiationEvents(
  norm: NormHistory[],
  firstFiled: Map<string, Day>,
  lotArea: (id: ParcelId) => number
): InitiationEvents {
  const res: InitiationEvents = {
    timeline: new Map(),
    noPermit: 0,
    noParcel: 0,
    noStart: 0,
    outOfRange: 0,
    eventsCovered: 0
  };
  const arr = (p: ParcelId): Int8Array => {
    let t = res.timeline.get(p);
    if (!t) {
      t = new Int8Array(PANEL_MONTHS);
      res.timeline.set(p, t);
    }
    return t;
  };

  const sorted = [...norm].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const events: { parcel: ParcelId; month: number; code: number }[] = [];
  for (const h of sorted) {
    const f = firstEntered(h);
    if (f === undefined) {
      res.noStart++;
      continue;
    }
    let day: Day;
    let code: number;
    if (f >= RECORD_DAY) {
      day = f;
      code = EVENT_RECORD;
    } else {
      const p = firstFiled.get(h.id);
      if (p === undefined) {
        res.noPermit++;
        continue;
      }
      day = p;
      code = EVENT_PERMIT;
    }
    if (h.parcelIds.length === 0) {
      res.noParcel++;
      continue;
    }
    const month = monthIndex(day);
    const last = h.end.kind === 'exit' ? monthIndex(h.end.day) : PANEL_MONTHS - 1;
    const from = Math.max(0, month + 1);
    const to = Math.min(PANEL_MONTHS - 1, last);
    for (const p of h.parcelIds) {
      const t = arr(p);
      if (from <= to) t.fill(COVERED, from, to + 1);
    }
    if (month < 0 || month >= PANEL_MONTHS) res.outOfRange++;
    else events.push({ parcel: primaryParcel(h.parcelIds, lotArea), month, code });
  }
  for (const e of events) {
    const t = arr(e.parcel);
    if (t[e.month] !== 0) res.eventsCovered++;
    else t[e.month] = e.code;
  }
  return res;
}

export interface FitCell {
  /** raw (initial-edge) bin index per `PANEL_FEATURES` feature */
  bins: number[];
  /** 1 = permit basis, 0 = record basis */
  basis: 0 | 1;
  exposure: number;
  events: number;
}

export interface PanelResult {
  /** key = `${rollYear}|${bins.join(',')}|${basis}` */
  cells: Map<string, FitCell>;
  years: number[];
  /** hostable_base parcel-years read */
  parcelYears: number;
  exposureMonths: number;
  events: { record: number; permit: number };
  /** timeline events whose parcel-year has no panel row or is not hostable_base */
  eventsOffPanel: number;
  eventsCovered: number;
  /** maxima over at-risk parcel-years; -Infinity if none */
  maxAtRisk: { potentialRatio: number; storiesGap: number };
  /** per mask bit 0..6, at-risk parcel-months / event months whose row has the bit set */
  mask: { exposure: number[]; events: number[]; anyExposure: number; anyEvents: number };
}

/**
 * Aggregates the panel into fit cells, one roll year at a time (months of year Y use roll Y).
 * Only `hostableBase` rows count; a parcel absent from the timeline is at risk all 12 months.
 */
export async function aggregatePanel(
  src: PanelSource,
  ev: Pick<InitiationEvents, 'timeline' | 'eventsCovered'>,
  edges: Record<FeatureId, number[]>
): Promise<PanelResult> {
  for (const f of PANEL_FEATURES) {
    if (!Array.isArray(edges[f]) || edges[f].length === 0) {
      throw new CalibrationError(`panel edges missing for ${f}`);
    }
  }
  let timelineEvents = 0;
  for (const t of ev.timeline.values()) for (const v of t) if (v > 0) timelineEvents++;

  const years = [...new Set(src.years)]
    .filter((y) => y >= FIRST_YEAR && y <= LAST_YEAR)
    .sort((a, b) => a - b);
  const res: PanelResult = {
    cells: new Map(),
    years,
    parcelYears: 0,
    exposureMonths: 0,
    events: { record: 0, permit: 0 },
    eventsOffPanel: 0,
    eventsCovered: ev.eventsCovered,
    maxAtRisk: { potentialRatio: -Infinity, storiesGap: -Infinity },
    mask: {
      exposure: new Array<number>(MASK_BITS).fill(0),
      events: new Array<number>(MASK_BITS).fill(0),
      anyExposure: 0,
      anyEvents: 0
    }
  };

  const exposure = [0, 0];
  const events = [0, 0];
  for (const y of years) {
    const rows = await src.read(y);
    const base = (y - FIRST_YEAR) * 12;
    let prev: string | undefined;
    for (const r of rows) {
      if (prev !== undefined && !(r.mapblklot > prev)) {
        throw new CalibrationError(`panel rows not sorted by mapblklot: ${r.mapblklot} ${y}`);
      }
      prev = r.mapblklot;
      const imp = r.imputed;
      if (!Number.isInteger(imp) || imp < 0 || imp > 255) {
        throw new CalibrationError(`panel imputed invalid: ${r.mapblklot} ${y}`);
      }
      if (imp & 0x80) throw new CalibrationError(`panel imputed bit 7 set: ${r.mapblklot} ${y}`);
      if (!r.hostableBase) continue;
      res.parcelYears++;

      exposure[0] = exposure[1] = events[0] = events[1] = 0;
      const t = ev.timeline.get(r.mapblklot);
      for (let k = 0; k < 12; k++) {
        const month = base + k;
        const v = t ? t[month] : 0;
        if (v === COVERED) continue;
        const basis =
          v === EVENT_PERMIT ? 1 : v === EVENT_RECORD ? 0 : month < RECORD_MONTH ? 1 : 0;
        exposure[basis]++;
        if (v > 0) events[basis]++;
      }
      const rowExposure = exposure[0] + exposure[1];
      if (rowExposure === 0) continue;
      const rowEvents = events[0] + events[1];

      const bins = PANEL_FEATURES.map((f) => {
        const x = r.features[f];
        if (!Number.isFinite(x)) {
          throw new CalibrationError(`panel feature ${f} not finite: ${r.mapblklot} ${y}`);
        }
        return binIndex(edges[f], x);
      });
      const binKey = bins.join(',');
      for (const basis of [0, 1] as const) {
        if (exposure[basis] === 0) continue;
        const key = `${y}|${binKey}|${basis}`;
        const c = res.cells.get(key);
        if (c) {
          c.exposure += exposure[basis];
          c.events += events[basis];
        } else {
          res.cells.set(key, {
            bins: [...bins],
            basis,
            exposure: exposure[basis],
            events: events[basis]
          });
        }
      }

      res.exposureMonths += rowExposure;
      res.events.record += events[0];
      res.events.permit += events[1];
      const bits = imp & 0x7f;
      if (bits) {
        res.mask.anyExposure += rowExposure;
        res.mask.anyEvents += rowEvents;
        for (let b = 0; b < MASK_BITS; b++) {
          if (bits & (1 << b)) {
            res.mask.exposure[b] += rowExposure;
            res.mask.events[b] += rowEvents;
          }
        }
      }
      const pr = r.features.potentialRatio;
      const sg = r.features.storiesGap;
      if (pr > res.maxAtRisk.potentialRatio) res.maxAtRisk.potentialRatio = pr;
      if (sg > res.maxAtRisk.storiesGap) res.maxAtRisk.storiesGap = sg;
    }
  }
  res.eventsOffPanel = timelineEvents - res.events.record - res.events.permit;
  return res;
}

const num = (v: unknown): number => (v === null || v === undefined ? NaN : Number(v));

/** A `PanelSource` over the build's `scenario_panel` table, read one roll year at a time. */
export async function duckPanelSource(db: Duck): Promise<PanelSource> {
  const ys = await db.all<{ roll_year: number }>(
    `SELECT DISTINCT roll_year FROM scenario_panel WHERE roll_year BETWEEN ${FIRST_YEAR} AND ${LAST_YEAR} ORDER BY 1`
  );
  return {
    years: ys.map((r) => r.roll_year),
    async read(y) {
      if (!Number.isInteger(y)) throw new CalibrationError(`panel roll year ${y} not an integer`);
      const rows = await db.all<Record<string, unknown>>(
        'SELECT mapblklot, hostable_base, imputed, potential_ratio_base, existing_units, ' +
          'lot_area_m2, year_built, stories_gap_base, improvement_share, ' +
          'CAST(rent_control_likely AS INTEGER) AS rcl, land_use_class ' +
          `FROM scenario_panel WHERE roll_year = ${y} ORDER BY mapblklot`
      );
      return rows.map((r) => ({
        mapblklot: String(r.mapblklot),
        hostableBase: r.hostable_base === true,
        imputed: num(r.imputed),
        features: {
          potentialRatio: num(r.potential_ratio_base),
          existingUnits: num(r.existing_units),
          lotAreaM2: num(r.lot_area_m2),
          yearBuilt: num(r.year_built),
          storiesGap: num(r.stories_gap_base),
          improvementShare: num(r.improvement_share),
          rentControlLikely: num(r.rcl),
          landUseClass: num(r.land_use_class)
        }
      }));
    }
  };
}
