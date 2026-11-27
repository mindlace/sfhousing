// The record-check lines the owner accepted as known misses (building-choice spec, Acceptance;
// docs/dev/building-choice.md, "Known misses"). `scripts/record-check.ts` prints a listed line that
// misses as `accepted` and exits 0 when no other line misses; a miss not listed here still exits 1.
// Each entry is a check's line key, exactly as the check prints it, with the ruling's date and the
// dataset it was ruled on. Remove an entry once its follow-up (the density-bonus spec) lands or
// the line passes again. Construction to completion at ≤ 4 stories, accepted on 2026-11-27, left
// the list once its target was taken on the height-time fit's spells and it passed.

export interface AcceptedMiss {
  /** The check's line key (`CheckLine.check`). */
  check: string;
  /** The owner's ruling, ISO day. */
  ruling: string;
  /** The dataset version the ruling was made on. */
  dataset: string;
}

const RULING = '2026-11-27';
const DATASET = '2026-11-27-247eaa0b';

export const ACCEPTED_MISSES: readonly AcceptedMiss[] = [
  'height ÷ limit ≤ 4: mean',
  'height ÷ limit ≤ 4: share ≥ 0.9',
  'height ÷ limit ≤ 6: mean',
  'height ÷ limit ≤ 6: share ≥ 0.9',
  'Type I share 8 to 12 stories',
  'permit issued to construction ≤ 12 stories (months)',
  'construction to completion ≤ 12 stories (months)',
  'homes per project ≤ 7 stories',
  'homes per project ≤ 12 stories'
].map((check) => ({ check, ruling: RULING, dataset: DATASET }));
