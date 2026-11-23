/**
 * Restore and open for the schema 4 /sim page (timeline-ui rule 40, R-3): the autosave's outcome
 * and `openSimDoc4`'s reconcile report as today's notices, plus "upgraded" (a document saved
 * before policies had dates) and, when spans were re-aligned to the dataset, one moved-dates
 * notice with its lines behind Details (OQ-4). `codec.load` drops the report, so the text the
 * restore loads is opened again here for it. Pure TS: the notices are data, SimNotices renders
 * them.
 */
import { formatMonthYear } from '$lib/fzp/format';
import type { Autosave, AutosaveNotice } from '$lib/sharing/autosave.svelte';
import { copyFor } from '$lib/sharing/copy';
import { fundingNotices } from '$lib/sim-page/funding-copy';
import { changeText } from '$lib/sim-page/reconcile';
import { SIM_KEY } from '$lib/sim-page/sim-doc';
import { TIMING_NOTICE_TEXT, type SimNotice } from '$lib/sim-page/sim-session';
import { monthFirstDay } from '$lib/sim/world/months';
import type { Day } from '$lib/timelapse/time';
import { DATES_MOVED_NOTICE } from './copy';
import type { SimPolicy4 } from './policy4';
import type { Policy4Report } from './reconcile4';
import {
  SIM_KEY4,
  migrateSimAutosave,
  openSimDoc4,
  type OpenDataset,
  type SimDoc4
} from './sim-doc4';

export type SimNotice4 = Omit<SimNotice, 'id' | 'tone'> & {
  id: SimNotice['id'] | 'upgraded' | 'dates-moved' | 'unparsable';
  /** 'alert': the page has nothing to show (a shared text that won't open). */
  tone?: SimNotice['tone'] | 'alert';
};

/** `from` is the month and year of model month 1. */
export const UPGRADED_TEXT = (from: string): string =>
  `Saved before policies had dates. Each starts ${from}.`;

const SIM = copyFor('sim');

/** The notice for the autosave's own outcome (N1, N2, N3 in the policy wording), or none. */
function autosaveNotice(n: AutosaveNotice | null): SimNotice4 | null {
  if (n === null) return null;
  switch (n.kind) {
    case 'corrupt':
      return { id: 'corrupt', text: SIM.n1, tone: 'info' };
    case 'future':
      return { id: 'future', text: SIM.n2, tone: 'info' };
    case 'rebased':
      return { id: 'rebased', text: SIM.n3(n.from, n.to), tone: 'info' };
  }
}

const range = (r: { from: Day; to: Day | null }): string =>
  `${formatMonthYear(r.from)} – ${r.to === null ? 'no end' : formatMonthYear(r.to)}`;

/** One line per re-aligned span: the policy's label and where the span is now. */
function spanLines(spans: Policy4Report['spans'], doc: SimPolicy4): string[] {
  const k = doc.kinds;
  const all = [...k.zoning, ...k.permitting, ...k.money];
  const label = (id: string) => all.find((p) => p.id === id)?.label ?? id;
  return [
    ...new Set(spans.map((s) => `${label(s.policy)}: ${s.now === null ? 'removed' : range(s.now)}`))
  ];
}

/** The report's notices, in today's order, then moved dates and "upgraded". */
function reportNotices(
  report: Policy4Report | null,
  upgradedFrom: number | undefined,
  doc: SimPolicy4,
  ds: OpenDataset
): SimNotice4[] {
  const out: SimNotice4[] = [];
  if (report) {
    out.push(...fundingNotices({ upgradedFrom: upgradedFrom === 2 ? 2 : null, ...report.funding }));
    const timing = report.timing.map((t) => t.change);
    if (timing.length > 0)
      out.push({
        id: 'timing',
        text: TIMING_NOTICE_TEXT,
        // The current set and the saved one can report the same change: list it once.
        details: [...new Set(timing.map(changeText))],
        tone: 'info'
      });
    if (report.spans.length > 0)
      out.push({
        id: 'dates-moved',
        text: DATES_MOVED_NOTICE,
        details: spanLines(report.spans, doc),
        tone: 'info'
      });
  }
  if (upgradedFrom === 2 || upgradedFrom === 3)
    out.push({
      id: 'upgraded',
      text: UPGRADED_TEXT(formatMonthYear(monthFirstDay(ds.asOf, 1))),
      tone: 'info'
    });
  return out;
}

/** The raw item under `key`, or null (missing, or storage throws). */
function rawItem(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** The `plan` text of the record under `key`, or null (missing, unreadable, storage throws). */
function planText(storage: Storage, key: string): string | null {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    const r: unknown = JSON.parse(raw);
    const plan = (r as { plan?: unknown } | null)?.plan;
    return typeof plan === 'string' ? plan : null;
  } catch {
    return null;
  }
}

/**
 * Autosave restore: migrate v1 → v2 (R-3), restore, then the notices in today's order:
 * the autosave's, funding (from the report), timing, moved dates, 'upgraded' when the document
 * was schema 2 or 3.
 */
export function restoreSim4(
  storage: Storage | null,
  autosave: Autosave<SimDoc4>,
  ds: OpenDataset
): { doc: SimDoc4; notices: SimNotice4[] } {
  // The text the restore will load from storage: the v2 record's, or the v1 one it migrates.
  let stored: string | null = null;
  /** A v1 text the migration could not write: it opens as a hand-off instead. */
  let unmigrated: string | undefined;
  /** A v1 record that could not be read: kept where it is, and said so (N1). */
  let lost = false;
  if (storage) {
    stored = planText(storage, SIM_KEY4);
    if (stored === null) {
      const v1 = planText(storage, SIM_KEY);
      const had = rawItem(storage, SIM_KEY) !== null;
      // 'kept': a v2 record is there but unreadable; the restore reports it, the v1 stays put.
      const m = migrateSimAutosave(storage, ds);
      if (m === 'migrated') stored = v1;
      else if (m === 'none' && v1 !== null && openSimDoc4(v1, ds).ok) unmigrated = v1;
      else if (m === 'none') lost = had;
    }
  }
  const handoffText = unmigrated;
  const r = autosave.restore(handoffText);
  const handoff = handoffText !== undefined ? openSimDoc4(handoffText, ds) : null;
  const fresh = r.notice?.kind === 'corrupt' || r.notice?.kind === 'future';
  const opened =
    handoff?.ok === true ? handoff : !fresh && stored !== null ? openSimDoc4(stored, ds) : null;
  const report = opened?.ok ? opened.value.report : null;
  const upgradedFrom = (opened?.ok ? opened.value.upgradedFrom : undefined) ?? r.upgradedFrom;

  const notices: SimNotice4[] = [];
  const first = autosaveNotice(r.notice ?? (lost ? { kind: 'corrupt' } : null));
  if (first) notices.push(first);
  notices.push(...reportNotices(report, upgradedFrom, r.plan.policy, ds));
  return { doc: r.plan, notices };
}

/** A shared document's text, opened (view mode and the /s Retry path). */
export function openShared(
  text: string,
  ds: OpenDataset,
  upgradedFrom?: number
): { ok: true; doc: SimDoc4; notices: SimNotice4[] } | { ok: false } {
  const r = openSimDoc4(text, ds);
  if (!r.ok) return { ok: false };
  const { doc, report } = r.value;
  const from = r.value.upgradedFrom ?? upgradedFrom;
  return { ok: true, doc, notices: reportNotices(report, from, doc.policy, ds) };
}
