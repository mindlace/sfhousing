/**
 * About this model: every string of its parts, in one place (docs/dev/about.md). Amounts, dates
 * and the goal's source are read from the goal and the targets, never copied.
 */
import { formatMonthYear } from '$lib/fzp/format';
import { BUFFER_SHARE, bufferAmount, GOAL } from '$lib/goal/goal';
import { ROOM_MEANS } from '$lib/paint/details';
import { formatCount } from '$lib/scoreboard/format';
import { M1_TARGETS } from '$lib/scoreboard/targets';

/** The parts' element ids, on the page and in the dialog: links name them as /about#<id>. */
export const ABOUT_ID = {
  meanings: 'about-meanings',
  assumptions: 'about-assumptions',
  data: 'about-data',
  using: 'about-using',
  shortcuts: 'about-shortcuts'
} as const;
export type AboutPart = keyof typeof ABOUT_ID;

export const ABOUT_TITLE = 'About this model';
export const ABOUT_INTRO =
  'I built this to show what zoning, permitting and public money could do for housing in San Francisco.';

export const PART_HEADING: Record<'meanings' | 'assumptions' | 'data' | 'using', string> = {
  meanings: 'What the numbers mean',
  assumptions: 'Assumptions',
  data: 'Data and licences',
  using: 'Using it'
};

const goalSource = M1_TARGETS[0].source;
const bufferPercent = Math.round(BUFFER_SHARE * 100);

/** Part 1's terms, in order; `body` composes from GOAL, bufferAmount and M1_TARGETS. */
export const MEANINGS: readonly {
  term: string;
  body: string;
  source?: { label: string; url: string };
}[] = [
  { term: 'Room for N homes', body: ROOM_MEANS.join(' ') },
  {
    term: 'Homes by a date',
    body: "Homes the forecast completes from today to that month, net of homes removed. It holds today's market."
  },
  {
    term: 'From your policy',
    body: 'The forecast runs twice, with your policy and under current law. This is the difference.'
  },
  {
    term: 'Current law',
    body: 'The Family Zoning Plan as adopted, permitting as observed, and City funding today.'
  },
  {
    term: 'The goal',
    body:
      `The state target: ${formatCount(GOAL.amount)} ${GOAL.measure.unit} by ` +
      `${formatMonthYear(GOAL.deadline)}, counted from ${formatMonthYear(GOAL.countsFrom)}, so ` +
      "homes built since then count. It is San Francisco's share of RHNA 2023–2031, the state's " +
      'Regional Housing Needs Allocation.',
    source: { label: goalSource.label, url: goalSource.url }
  },
  {
    term: `The goal + ${bufferPercent}%`,
    body: `The state asks for room for at least ${bufferPercent}% more: ${formatCount(bufferAmount(GOAL))} ${GOAL.measure.unit}.`
  }
];

export const YOUR_PLANS: readonly [string, string] = [
  "Published plans and policies are public and permanent: anyone with the link can see them, and I can't take them back.",
  'Reopening a saved plan uses the current data, so its totals can change.'
];

export const WORKED_OUT = 'How this is worked out';
export const ASSUMPTIONS_SHOW = 'Show the assumptions';
export const ASSUMPTIONS_FAILED = "The assumptions couldn't load.";
