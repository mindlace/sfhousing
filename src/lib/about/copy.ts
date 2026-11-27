/**
 * About this model: every string of its parts, in one place (docs/dev/about.md). Amounts, dates
 * and the goal's source are read from the goal and the targets, never copied.
 */
import { formatMonthYear } from '$lib/fzp/format';
import { MAX_SAVES } from '$lib/game/saves';
import { BUFFER_SHARE, bufferAmount, GOAL_BASE } from '$lib/goal/goal';
import { ROOM_MEANS } from '$lib/paint/details';
import { formatCount } from '$lib/scoreboard/format';
import { RHNA_DEADLINE } from '$lib/sim/scenario/score';
import { WINDOW_MONTHS } from '$lib/sim/timeline-client';
import { M1_TARGETS } from '$lib/scoreboard/targets';

/** The parts' element ids, on the page and in the dialog: links name them as /about#<id>. */
export const ABOUT_ID = {
  meanings: 'about-meanings',
  assumptions: 'about-assumptions',
  data: 'about-data',
  using: 'about-using',
  shortcuts: 'about-shortcuts',
  levels: 'about-levels',
  savedGames: 'about-saved-games'
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

/** Part 1's terms, in order; `body` composes from GOAL_BASE, bufferAmount and M1_TARGETS. */
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
      `${formatCount(GOAL_BASE.amount)} ${GOAL_BASE.measure.unit} by the deadline, ` +
      `counted from ${formatMonthYear(GOAL_BASE.countsFrom)}, so homes built since then count. ` +
      "It is San Francisco's share of RHNA 2023–2031, the state's Regional Housing Needs " +
      `Allocation, which asks for them by ${formatMonthYear(RHNA_DEADLINE)}.`,
    source: { label: goalSource.label, url: goalSource.url }
  },
  {
    term: `The goal + ${bufferPercent}%`,
    body: `The state asks for room for at least ${bufferPercent}% more: ${formatCount(bufferAmount(GOAL_BASE))} ${GOAL_BASE.measure.unit}.`
  },
  {
    term: 'The deadline',
    body:
      `When the goal must be met. The first is the end of the ${WINDOW_MONTHS / 12}-year ` +
      'window; each later one is five or more years earlier. Taking the next one is your choice.'
  }
];

export const YOUR_PLANS: readonly [string, string] = [
  "Published plans and policies are public and permanent: anyone with the link can see them, and I can't take them back.",
  'Reopening a saved plan uses the current data, so its totals can change.'
];

/** Using it: the game, in order. */
export const GAME_STEPS: readonly string[] = [
  'Paint room for the goal, then press Start.',
  'Play the forecast, or drag the playhead. Seeing the month current law reaches the goal is your first win.',
  'Each win offers a few new policies. Switch them on or off and watch the date move.',
  'Beat your best month by any means to win again. A policy you win with becomes yours to edit.'
];

export const GAME_NOTES: readonly string[] = [
  'Painting happens once, at the start, to show how much has to be built. The simulation runs your policy.',
  'A change to a policy takes the timeline back to the month it starts.',
  'A published policy plays in full for everyone.'
];

export const SAVED_GAMES: readonly string[] = [
  `Each saved game has its own plan, policy, round and best month. You can keep ${MAX_SAVES}.`,
  'The Menu in the header opens your saved games.',
  'Games are saved in this browser, and to your account from your first win.'
];

export const WORKED_OUT = 'How this is worked out';
export const ASSUMPTIONS_SHOW = 'Show the assumptions';
export const ASSUMPTIONS_FAILED = "The assumptions couldn't load.";

/** Assumptions' Cars section (car-ownership Task 12), shown when the dataset has car data. */
export const CARS_HEADING = 'Cars';
export const CARS_ABOUT: readonly string[] = [
  "Each household's cars (none to three or more) come from a choice model fitted to Census data: household records (PUMS) and block-group car counts (ACS table B25044).",
  'New homes take the kinds of households that recently moved into new buildings, and their parking follows the cars those households are expected to own.'
];
/** The link after the sentences, to the car model's figures and sources in the assumptions. */
export const CARS_DETAILS = 'Details';
