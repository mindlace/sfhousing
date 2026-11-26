/** The game's words on /sim: the tree's fixed words. */

export const NOT_BOUGHT = 'Not bought yet';
export const LOCKED_LANE = 'Opens in the tree';

/** What reaching the goal opens: levers and, when it beats the bar, an earlier goal. */
export function goalUnlocks(levers: number, earlier: boolean): string {
  const lev = levers === 0 ? '' : `${levers} ${levers === 1 ? 'lever' : 'levers'}`;
  if (!earlier) return lev;
  return lev === '' ? 'an earlier goal' : `${lev} and an earlier goal`;
}
