import { DATASET_VERSION_RE } from '$lib/data/manifest';
export { DATASET_VERSION_RE };

const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
const MAX_PATH = 256;

/** Maps a request path to an R2 key, or null if the path is not servable (spec §4.4). */
export function dataKey(version: string, rest: string): string | null {
  if (!DATASET_VERSION_RE.test(version)) return null;
  if (rest.length < 1 || rest.length > MAX_PATH) return null;
  for (const seg of rest.split('/')) {
    if (seg === '.' || seg === '..' || !SEGMENT_RE.test(seg)) return null;
  }
  return `data/${version}/${rest}`;
}
