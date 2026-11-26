// The round catalogue's policies as documents: what is offered, and the reach check's documents.
import { fundingPresets } from '$lib/sim-page/funding-presets';
import { PRESETS } from '$lib/sim-page/timing';
import { WINDOW_MONTHS } from '$lib/sim/timeline-client';
import { monthFirstDay } from '$lib/sim/world/months';
import type { Calibration } from '$lib/timelapse/types';
import { AddLimitError, addPolicy, type AddChoice } from '$lib/timeline/add';
import { DEFAULT_POLICY4, type Policy, type SimPolicy4 } from '$lib/timeline/policy4';
import { CATALOGUE, keyOf, type PolicyKey, type RoundEntry } from './catalogue/rounds';

const allPolicies = (doc: SimPolicy4): Policy[] => [
  ...doc.kinds.zoning,
  ...doc.kinds.permitting,
  ...doc.kinds.money
];

function offered(entry: RoundEntry, cal: Calibration): boolean {
  if (entry.kind === 'permitting')
    return PRESETS.some((p) => p.id === entry.preset && p.id !== 'observed' && p.available);
  if (entry.kind === 'money')
    return fundingPresets(cal).some((p) => p.id === entry.preset && p.available);
  return true;
}

/**
 * `doc` with `entry`'s policies added at the end of its kind, `on` as given, in force from
 * monthFirstDay(cal.asOf, 1) with no end, each labelled `entry.label`. Transit: one policy with id
 * `entry.key`, preset null, where { tag: 'transit', stopTypes }, one bands span. Presets:
 * addPolicy's policies. `doc` itself when a policy with that key is already there, the dataset does
 * not offer the preset, or addPolicy throws AddLimitError.
 */
export function addEntry(
  doc: SimPolicy4,
  entry: RoundEntry,
  cal: Calibration,
  on: boolean
): SimPolicy4 {
  if (allPolicies(doc).some((p) => keyOf(p) === entry.key)) return doc;
  if (entry.kind === 'zoning') {
    const made: Policy = {
      id: entry.key,
      label: entry.label,
      preset: null,
      on,
      where: { tag: 'transit', stopTypes: [...entry.stopTypes] },
      spans: [
        {
          from: monthFirstDay(cal.asOf, 1),
          to: null,
          what: {
            tag: 'bands',
            bands: entry.bands.map((b) => ({ maxM: b.maxM, stories: b.stories }))
          }
        }
      ]
    };
    return { ...doc, kinds: { ...doc.kinds, zoning: [...doc.kinds.zoning, made] } };
  }
  if (!offered(entry, cal)) return doc;
  const choice: AddChoice =
    entry.kind === 'permitting'
      ? { kind: 'permitting', what: 'preset', preset: entry.preset }
      : { kind: 'money', what: 'preset', preset: entry.preset };
  try {
    const w = { asOf: cal.asOf, months: WINDOW_MONTHS };
    const added = addPolicy(doc, choice, { w, month: 1, cal }).doc;
    const had = doc.kinds[entry.kind].length;
    const list = added.kinds[entry.kind].map((p, i) =>
      i < had ? p : { ...p, label: entry.label, on }
    );
    return { ...added, kinds: { ...added.kinds, [entry.kind]: list } };
  } catch (e) {
    if (e instanceof AddLimitError) return doc;
    throw e;
  }
}

/** Every entry of rounds 1..round, and every key in `also`, missing from `doc`, added off. */
export function offerThrough(
  doc: SimPolicy4,
  round: number,
  cal: Calibration,
  also: Iterable<string> = []
): SimPolicy4 {
  const extra = new Set(also);
  let out = doc;
  for (const e of CATALOGUE) {
    if (e.round <= round || extra.has(e.key)) out = addEntry(out, e, cal, false);
  }
  return out;
}

/** Current law with `keys` added on, in catalogue order (the reach check's documents). */
export function catalogueDoc(cal: Calibration, keys: readonly PolicyKey[]): SimPolicy4 {
  const want = new Set<string>(keys);
  let out = DEFAULT_POLICY4;
  for (const e of CATALOGUE) if (want.has(e.key)) out = addEntry(out, e, cal, true);
  return out;
}

/** The keys of the policies in `doc` that are on. */
export function onKeys(doc: SimPolicy4): Set<PolicyKey> {
  const out = new Set<PolicyKey>();
  for (const p of allPolicies(doc)) {
    const k = p.on ? keyOf(p) : null;
    if (k !== null) out.add(k);
  }
  return out;
}
