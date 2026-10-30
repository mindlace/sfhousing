import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseCalibration } from '../src/lib/timelapse/model';
import { disapprovedShare, DISAPPROVAL_NEGLIGIBLE } from '../src/lib/sim/levers/timers';

/** Prints, per pathway, the eventual disapproved share of new projects for a calibration.json. */
function main(path: string | undefined): void {
  if (!path) throw new Error('usage: disapproval-share.ts <calibration.json>');
  const cal = parseCalibration(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  for (const [pathway, share] of Object.entries(disapprovedShare(cal))) {
    const verdict = share < DISAPPROVAL_NEGLIGIBLE ? 'negligible' : 'NOT negligible';
    process.stdout.write(`${pathway} ${share.toFixed(4)} (${verdict})\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv[2]);
