// The round panel's text and the gift's explainers (pure).
import { formatShortMonthYear } from '$lib/fzp/format';
import type { Day } from '$lib/timelapse/time';
import type { Policy, SimPolicy4 } from '$lib/timeline/policy4';
import { ROUNDS, bandsText, keyOf, roundEntries, rulesText } from './catalogue/rounds';
import { monthsBetween, spanText } from './rounds';
import type { GameState } from './state';
import { roundName } from './ui/round-words';

export interface RoundPanelData {
  title: string;
  items: string[];
  earlier: string[];
}

export interface GiftItem {
  title: string;
  line: string;
  rules: string;
}

const allPolicies = (doc: SimPolicy4): Policy[] => [
  ...doc.kinds.zoning,
  ...doc.kinds.permitting,
  ...doc.kinds.money
];

/**
 * title: roundName; items: the current round's entries as `${label}: ${rulesText(entry, policy)}`,
 * with ' (off)' when its policy is off (or not in the document), or ['No policies yet'] in round 0,
 * none when finished; earlier: newest first, 'Round 1: goal reached Jun 2060, 1 yr 4 mo earlier'
 * (no ', … earlier' when beat is null), and for a round-0 win 'Baseline: Oct 2061' or
 * 'Baseline: after Oct 2066' (`legal`, when the goal was not reached). A win after the one that
 * finished the game (the first of round ROUNDS) is named 'Every policy:', not 'Round 4:'.
 */
export function roundPanel(s: GameState, doc: SimPolicy4, legal: Day): RoundPanelData {
  let items: string[] = [];
  if (!s.finished) {
    if (s.round === 0) {
      items = ['No policies yet'];
    } else {
      const policies = allPolicies(doc);
      items = roundEntries(s.round).map((e) => {
        const p = policies.find((x) => keyOf(x) === e.key);
        const off = p === undefined || !p.on ? ' (off)' : '';
        return `${e.label}${off}: ${rulesText(e, p)}`;
      });
    }
  }
  // The first win of the last round finished the game; a later one came after the end.
  const ending = s.wins.findIndex((w) => w.round === ROUNDS);
  const earlier = s.wins
    .map((w, i) => {
      const name = ending !== -1 && i > ending ? roundName(ROUNDS, true) : `Round ${w.round}`;
      if (w.round === 0) {
        return `Baseline: ${w.goalMonth === null ? 'after ' + formatShortMonthYear(legal) : formatShortMonthYear(w.goalMonth)}`;
      }
      if (w.goalMonth === null) return `${name}: after ${formatShortMonthYear(legal)}`;
      const months = w.beat === null ? 0 : monthsBetween(w.goalMonth, w.beat);
      const by = months > 0 ? `, ${spanText(months)} earlier` : '';
      return `${name}: goal reached ${formatShortMonthYear(w.goalMonth)}${by}`;
    })
    .reverse();
  return { title: roundName(s.round, s.finished), items, earlier };
}

/**
 * After takeWin: the new round's entries (rules: bandsText of the fixed bands with a final period,
 * empty for the others, whose line is their rules), or [{ title: 'Every policy', ... }] when this
 * win finished the game; [] when it was finished before.
 */
export function giftItems(before: GameState, after: GameState): GiftItem[] {
  if (before.finished) return [];
  if (after.finished) {
    return [{ title: 'Every policy', line: 'Every lever is yours to add and edit.', rules: '' }];
  }
  return roundEntries(after.round).map((e) => ({
    title: e.label,
    line: e.line,
    rules: e.kind === 'zoning' ? `${bandsText(e.bands, e)}.` : ''
  }));
}
