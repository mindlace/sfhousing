// The car system (`CarSystem`): the household population by block group, kept in step with the
// homes the world builds and loses. It buffers what the step's events do to housing (homes
// completed by mix, homes lost at construction starts, projects started) and, between systems 3
// and 4, steps every zone: the pending homes become households (`occupied` share, rounded on
// `OCCUPY`), then `stepZone`. With the link on and parking costs set, each refresh records the
// zones whose parking demand moved (`pushShifts`) and `timelineOf` lays them over the policy as
// start-odds shifts (`parkingTimeline`); otherwise it only observes.
import type { CarData } from '$lib/data/cars-codec';
import * as carsModule from '$lib/sim/cars';
import type { CarDraw, CarModel } from '$lib/sim/cars';
import * as tiersModule from '$lib/sim/finance/tiers';
import * as rngModule from '$lib/sim/world/rules/rng';
import type { Statics } from '../statics';
import * as typesModule from '../types';
import type { CarSystem, World } from '../types';
import * as columnsModule from './columns';
import type { CarColumns } from './columns';
import * as parkingModule from './parking';

// Bound once (docs/dev/world-core.md, Cost).
const {
  CAR_P,
  MIXES,
  affordableSpaces,
  predictedSpaces,
  refreshTable,
  roundSystematic,
  splitSystematic,
  stepZone
} = carsModule;
const { inclusionaryUnits } = tiersModule;
const { drawOn, seedHash, streamOf, zoneEntity } = rngModule;
const { ORIGIN_MASTER, ORIGIN_PHASE, ORIGIN_SIM } = typesModule;
const { carColumnsOf } = columnsModule;
const { parkingTimeline, pushShifts } = parkingModule;

const NM = MIXES.length;
const MARKET = MIXES.indexOf('market');
const VERY_LOW = MIXES.indexOf('veryLow');
const LOW = MIXES.indexOf('low');
const MODERATE = MIXES.indexOf('moderate');

/** Each pipeline project's zone and each phase's: their first lot's, -1 when none. */
interface RowZones {
  project: Int32Array;
  phases: Int32Array[];
}

export interface CarSystemOptions {
  /**
   * Default true: parking demand reaches start odds (`parkingTimeline`). False, or a model whose
   * `parking.costPerSpace` is null, leaves the timeline alone and records no shift entries.
   */
  link?: boolean;
}

/** The car system on `data` (zones, lots' zones, start households) and `model`. */
export function createCarSystem(
  data: CarData,
  model: CarModel,
  opts: CarSystemOptions = {}
): CarSystem {
  const link = (opts.link ?? true) && model.parking.costPerSpace !== null;
  const Z = data.zones.length;
  const entity = new Float64Array(Z);
  for (let z = 0; z < Z; z++) entity[z] = zoneEntity(data.zones[z]);
  const lotZone = data.lotZone;
  const tierShares = [
    model.newHomes.affordableTiers.veryLow,
    model.newHomes.affordableTiers.low,
    model.newHomes.affordableTiers.moderate
  ];
  const tierSplit = new Int32Array(3);
  const fills = new Int32Array(NM);
  const memo = new WeakMap<Statics, RowZones>();

  const zoneOfLot = (lot: number): number => (lot >= 0 && lot < lotZone.length ? lotZone[lot] : -1);

  /** The zone of the first of `ids` that is a lot, -1 when none is (or it has no zone). */
  const zoneOfIds = (index: Map<string, number>, ids: readonly string[]): number => {
    for (const id of ids) {
      const lot = index.get(id);
      if (lot !== undefined) return zoneOfLot(lot);
    }
    return -1;
  };

  const rowZonesOf = (statics: Statics): RowZones => {
    let hit = memo.get(statics);
    if (hit) return hit;
    const index = new Map<string, number>();
    statics.parcelId.forEach((id, i) => index.set(id, i));
    const project = new Int32Array(statics.projects.length);
    const phases: Int32Array[] = [];
    statics.projects.forEach((p, k) => {
      project[k] = zoneOfIds(index, p.parcelIds);
      phases.push(Int32Array.from((p.phases ?? []).map((ph) => zoneOfIds(index, ph.parcelIds))));
    });
    hit = { project, phases };
    memo.set(statics, hit);
    return hit;
  };

  /** A row's zone: a start's lot's, a pipeline row's or phase's first lot's; -1 for none. */
  const zoneOfRow = (world: World, statics: Statics, row: number): number => {
    const p = world.projects;
    const origin = p.origin[row];
    if (origin === ORIGIN_SIM) return zoneOfLot(p.src[row]);
    const rz = rowZonesOf(statics);
    if (origin === ORIGIN_PHASE) {
      const z = rz.phases[p.src[row]][p.sub[row] - 1];
      return z === undefined ? -1 : z;
    }
    return rz.project[p.src[row]];
  };

  /** A completed row's homes, by mix, into its zone's pending fills. */
  const complete = (c: CarColumns, world: World, statics: Statics, row: number): void => {
    const p = world.projects;
    if (p.origin[row] === ORIGIN_MASTER) return;
    const last = p.revLast[row];
    const units = last >= 0 ? p.revUnits[last] : p.units[row];
    if (units <= 0) return;
    const z = zoneOfRow(world, statics, row);
    if (z < 0) {
      c.unplaced += units;
      return;
    }
    const at = z * NM;
    const pend = c.pendFill;
    if (p.kind[row] === 1) {
      // An affordable row's homes by tier, on the row's own stream: independent of event order.
      splitSystematic(units, tierShares, drawOn(p.stream[row], CAR_P.IN_TYPES, 0), tierSplit);
      pend[at + VERY_LOW] += tierSplit[0];
      pend[at + LOW] += tierSplit[1];
      pend[at + MODERATE] += tierSplit[2];
    } else if (p.origin[row] === ORIGIN_SIM) {
      // A market start's on-site inclusionary homes; aboveModerate ones fill with the market mix.
      const inc = inclusionaryUnits(units);
      pend[at + VERY_LOW] += inc.veryLow;
      pend[at + LOW] += inc.low;
      pend[at + MODERATE] += inc.moderate;
      pend[at + MARKET] += units - inc.veryLow - inc.low - inc.moderate;
    } else pend[at + MARKET] += units;
  };

  /** A construction start's existing homes into its zone's pending losses. */
  const construct = (c: CarColumns, world: World, statics: Statics, row: number): void => {
    const existing = world.projects.existing[row];
    if (existing <= 0) return;
    const z = zoneOfRow(world, statics, row);
    if (z < 0) c.unplaced += existing;
    else c.pendLost[z] += existing;
  };

  /** A start's homes and their predicted spaces, for the month's spaces per home. */
  const start = (c: CarColumns, world: World, statics: Statics, row: number): void => {
    const p = world.projects;
    if (p.origin[row] === ORIGIN_MASTER) return;
    const month = world.month + 1;
    // A start in system 3 of a refresh month reads the month's new table, as later starts do.
    tableFor(c, month);
    if (c.startMonth !== month) {
      c.startMonth = month;
      c.startHomes = 0;
      c.startSpaces = 0;
    }
    const units = p.units[row];
    const z = zoneOfRow(world, statics, row);
    if (z < 0 || units <= 0) return;
    const spaces = p.kind[row] === 1 ? affordableSpaces(c, model, z) : c.spaces[z];
    c.startHomes += units;
    c.startSpaces += units * spaces;
  };

  const refresh = (c: CarColumns, month: number): void => {
    refreshTable(c, model, data);
    c.tableMonth = month;
    for (let z = 0; z < Z; z++) c.spaces[z] = predictedSpaces(c, model, data, z);
    if (month > 0 && link) pushShifts(c, month);
  };

  /**
   * Refreshes the table once in a refresh month, at the first thing that reads it: a start's
   * spaces or the car step. Nothing moves households before the car step, so the table is the one
   * the step would make.
   */
  const tableFor = (c: CarColumns, month: number): void => {
    if (month > 1 && (month - 1) % model.refreshMonths === 0 && c.tableMonth !== month) {
      refresh(c, month);
    }
  };

  return {
    create(world) {
      const c = carColumnsOf(data, model);
      refresh(c, 0);
      c.base.set(c.spaces);
      world.cars = c;
    },

    onEvent(world, statics, e) {
      const c = world.cars;
      if (!c) throw new Error('cars: onEvent before create');
      if (e.kind === 'end') {
        if (e.how === 'complete') complete(c, world, statics, e.row);
      } else if (e.kind === 'enter') {
        if (e.stage === 'construction') construct(c, world, statics, e.row);
      } else if (e.kind === 'start') start(c, world, statics, e.row);
    },

    step(ctx) {
      const c = ctx.world.cars;
      if (!c) throw new Error('cars: step before create');
      const month = ctx.month;
      tableFor(c, month);
      const sh = seedHash(ctx.seed);
      let curZone = -1;
      let cur = 0;
      const draw: CarDraw = (zone, purpose, index) => {
        if (zone !== curZone) {
          curZone = zone;
          cur = streamOf(sh, entity[zone], month);
        }
        return drawOn(cur, purpose, index);
      };
      const pendFill = c.pendFill;
      const pendLost = c.pendLost;
      for (let z = 0; z < Z; z++) {
        const occ = data.occupied[z];
        for (let k = 0; k < NM; k++) {
          const homes = pendFill[z * NM + k];
          fills[k] = homes > 0 ? roundSystematic(occ * homes, draw(z, CAR_P.OCCUPY, k)) : 0;
        }
        const homes = pendLost[z];
        const lost = homes > 0 ? roundSystematic(occ * homes, draw(z, CAR_P.OCCUPY, NM)) : 0;
        c.unmatched += stepZone(c, model, data, z, fills, lost, draw);
      }
      pendFill.fill(0);
      pendLost.fill(0);
    },

    timelineOf(world, statics, timeline) {
      const c = world.cars;
      if (!link || c === undefined || c.shiftN === 0) return timeline;
      return parkingTimeline(timeline, c, data, model, statics);
    }
  };
}
