// `npx tsx scripts/timing-evidence.ts <projects.json>` (sim-timers plan Task 2): per-record evidence
// for the permitting presets in `src/lib/sim-page/timing-sources.ts`. Not part of the bundle.
//
// SB423_SMALL_SHARE: the share of streamlined-pathway projects with 150 or fewer units, the
// cutoff between the 90-day and the 180-day approval clock (Gov. Code § 65913.4(d)(1)).
//
// CEQA_FILED_RATIO is not measured here: the locked SF Planning extracts (`qvu5-m3a2`,
// `y673-d69b` in `pipeline/sources.lock.json`) select no environmental-review-type field, so
// exempt and non-exempt discretionary projects cannot be told apart per record.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseProjectsFile, type ProjectsFile } from '../src/lib/timelapse/projects';

export const SB423_UNITS_CUTOFF = 150;

/** Share of streamlined projects with `units <= 150`, and n (the streamlined projects counted). */
export function smallStreamlinedShare(file: ProjectsFile): {
  share: number;
  small: number;
  n: number;
} {
  const streamlined = file.projects.filter((p) => p.pathway === 'streamlined');
  const small = streamlined.filter((p) => p.units <= SB423_UNITS_CUTOFF).length;
  const n = streamlined.length;
  return { share: n > 0 ? small / n : NaN, small, n };
}

function main(path: string | undefined): void {
  if (!path) throw new Error('usage: timing-evidence.ts <projects.json>');
  const file = parseProjectsFile(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  const { share, small, n } = smallStreamlinedShare(file);
  const asOf = new Date(file.asOf * 86_400_000).toISOString().slice(0, 10);
  process.stdout.write(
    `SB423_SMALL_SHARE ${share.toFixed(4)} (${small} of ${n} streamlined projects with ` +
      `units <= ${SB423_UNITS_CUTOFF}; projects.json asOf ${asOf})\n`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv[2]);
