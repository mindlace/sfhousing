// G5: applying a grant to the policy document, with the editor's own functions.
import { fundingPresets } from '$lib/sim-page/funding-presets';
import { bandsInnermostFirst, type ZoningRule } from '$lib/sim-page/policy';
import { PRESETS, type PresetId } from '$lib/sim-page/timing';
import { addBand, setBandDistance, setBandStories, toggleStop } from '$lib/sim-page/transit-edit';
import { STOP_TYPES, type StopType } from '$lib/sim/levers/brushes';
import { WINDOW_MONTHS } from '$lib/sim/timeline-client';
import { monthFirstDay } from '$lib/sim/world/months';
import { AddLimitError, addPolicy, type AddChoice } from '$lib/timeline/add';
import type { addChoices } from '$lib/timeline/add';
import type { Policy, SimPolicy4 } from '$lib/timeline/policy4';
import { setOn } from '$lib/timeline/spans';
import { within } from './limits';
import type { Limits } from './limits';
import type { Grant } from './tree';

export const GAME_TRANSIT_ID = 'game-transit';

export interface GrantCtx {
  cal: Parameters<typeof addChoices>[1];
  limits: Limits;
}

/** The label of the transit rule the game makes, as the "+" menu labels one. */
export const GAME_TRANSIT_LABEL = 'Transit rule';

export function applyGrant(doc: SimPolicy4, grant: Grant, ctx: GrantCtx): SimPolicy4 {
  switch (grant.tag) {
    case 'preset':
      return givePreset(doc, 'permitting', grant.preset, ctx);
    case 'measure':
      return givePreset(doc, 'money', grant.preset, ctx);
    case 'stop':
      return giveStop(withGameRule(doc, ctx), grant.stop);
    case 'stories':
      return editGameRule(withGameRule(doc, ctx), (r) => raiseInnermost(r, ctx.limits.stories));
    case 'reach':
      return editGameRule(withGameRule(doc, ctx), (r) => reachOut(r, ctx.limits.reachM));
    case 'bands':
      return editGameRule(withGameRule(doc, ctx), (r) =>
        oneMoreBand(r, ctx.limits.bands, ctx.limits.reachM)
      );
    case 'hands':
      return doc;
  }
}

function offered(kind: 'permitting' | 'money', preset: string, ctx: GrantCtx): boolean {
  if (kind === 'permitting')
    return PRESETS.some((p) => p.id === preset && p.id !== 'observed' && p.available);
  return fundingPresets(ctx.cal).some((p) => p.id === preset && p.available);
}

function givePreset(
  doc: SimPolicy4,
  kind: 'permitting' | 'money',
  preset: string,
  ctx: GrantCtx
): SimPolicy4 {
  // A policy of this preset that the limits would not run (custom timings, say) is left alone.
  const named = doc.kinds[kind].filter((p) => p.preset === preset && within(kind, p, ctx.limits));
  if (named.some((p) => p.on)) return doc;
  if (named.length > 0) return setOn(doc, kind, named[0].id, true);
  if (!offered(kind, preset, ctx)) return doc;
  const choice: AddChoice =
    kind === 'permitting'
      ? { kind, what: 'preset', preset: preset as PresetId }
      : { kind, what: 'preset', preset };
  try {
    const w = { asOf: ctx.cal.asOf, months: WINDOW_MONTHS };
    return addPolicy(doc, choice, { w, month: 1, cal: ctx.cal }).doc;
  } catch (e) {
    if (e instanceof AddLimitError) return doc;
    throw e;
  }
}

const isGameRule = (p: Policy): boolean => p.id === GAME_TRANSIT_ID && p.where.tag === 'transit';

const allPolicies = (doc: SimPolicy4): Policy[] => [
  ...doc.kinds.zoning,
  ...doc.kinds.permitting,
  ...doc.kinds.money
];

function putGameRule(doc: SimPolicy4, next: Policy): SimPolicy4 {
  const zoning = doc.kinds.zoning.map((p) => (isGameRule(p) ? next : p));
  return { ...doc, kinds: { ...doc.kinds, zoning } };
}

/**
 * The game rule as the game would make it now, when the document has none: every stop type
 * bought, one band at the limits, from month 1. The document as it is when it has one, or when
 * no stop type is bought.
 */
function withGameRule(doc: SimPolicy4, ctx: GrantCtx): SimPolicy4 {
  if (doc.kinds.zoning.some(isGameRule)) return doc;
  if (allPolicies(doc).some((p) => p.id === GAME_TRANSIT_ID)) return doc;
  const { stops, reachM, stories } = ctx.limits;
  const stopTypes = STOP_TYPES.filter((t) => stops.has(t));
  if (stopTypes.length === 0 || reachM < 1 || stories < 1) return doc;
  const made: Policy = {
    id: GAME_TRANSIT_ID,
    label: GAME_TRANSIT_LABEL,
    preset: null,
    on: true,
    where: { tag: 'transit', stopTypes },
    spans: [
      {
        from: monthFirstDay(ctx.cal.asOf, 1),
        to: null,
        what: { tag: 'bands', bands: [{ maxM: reachM, stories }] }
      }
    ]
  };
  return { ...doc, kinds: { ...doc.kinds, zoning: [...doc.kinds.zoning, made] } };
}

/** The stop type joins the game rule, which is switched on. */
function giveStop(doc: SimPolicy4, stop: StopType): SimPolicy4 {
  const rule = doc.kinds.zoning.find(isGameRule);
  if (rule === undefined || rule.where.tag !== 'transit') return doc;
  const has = rule.where.stopTypes.includes(stop);
  if (has && rule.on) return doc;
  const stopTypes = has
    ? rule.where.stopTypes
    : toggleStop(
        { id: rule.id, kind: 'transit', stopTypes: rule.where.stopTypes, bands: [] },
        stop
      )!.stopTypes;
  return putGameRule(doc, { ...rule, on: true, where: { tag: 'transit', stopTypes } });
}

/** `edit` on every span of the game's rule; null from `edit` leaves that span as it is. */
function editGameRule(doc: SimPolicy4, edit: (r: ZoningRule) => ZoningRule | null): SimPolicy4 {
  const rule = doc.kinds.zoning.find(isGameRule);
  if (rule === undefined || rule.where.tag !== 'transit') return doc;
  const stopTypes = rule.where.stopTypes;
  let changed = false;
  const spans = rule.spans.map((s) => {
    if (s.what.tag !== 'bands') return s;
    const next = edit({ id: rule.id, kind: 'transit', stopTypes, bands: s.what.bands });
    if (next === null) return s;
    changed = true;
    return { ...s, what: { tag: 'bands' as const, bands: next.bands } };
  });
  return changed ? putGameRule(doc, { ...rule, on: true, spans }) : doc;
}

/** The innermost band, and each band out from it at the same stories, to `cap`. */
function raiseInnermost(r: ZoningRule, cap: number): ZoningRule | null {
  const bands = bandsInnermostFirst(r.bands);
  const was = bands[0]?.stories;
  if (was === undefined || cap <= was) return null;
  let out: ZoningRule = { ...r, bands };
  for (let i = 0; i < bands.length && bands[i].stories === was; i++) {
    out = setBandStories(out, i, cap);
  }
  return out;
}

/** The outermost band out to `maxM`; null when it is already there or further. */
function reachOut(r: ZoningRule, maxM: number): ZoningRule | null {
  const bands = bandsInnermostFirst(r.bands);
  const last = bands.length - 1;
  if (last < 0 || bands[last].maxM >= maxM) return null;
  return setBandDistance({ ...r, bands }, last, maxM);
}

/** One more band: beyond the outermost as the editor adds one, else inside it. */
function oneMoreBand(r: ZoningRule, most: number, maxM: number): ZoningRule | null {
  const bands = bandsInnermostFirst(r.bands);
  if (bands.length === 0 || bands.length >= most) return null;
  const added = addBand({ ...r, bands });
  if (added !== null && added.bands[added.bands.length - 1].maxM <= maxM) return added;
  const outer = bands[bands.length - 1];
  const inner = bands.length > 1 ? bands[bands.length - 2].maxM : 0;
  const mid = Math.round((inner + outer.maxM) / 2);
  if (mid <= inner || mid >= outer.maxM) return null;
  return { ...r, bands: [...bands.slice(0, -1), { maxM: mid, stories: outer.stories }, outer] };
}
