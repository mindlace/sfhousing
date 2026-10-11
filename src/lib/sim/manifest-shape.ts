// Worker-safe structural check of an I12 manifest (no zod: the worker bundle must stay zod-free).
import { DATASET_VERSION_RE } from '$lib/data/dataset-version';

/** Copy of CELL_ID_RE in src/lib/data/manifest.ts (that module imports zod). A test pins equality. */
export const CELL_ID_RE_COPY = /^-?\d+_-?\d+$/;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** null when the manifest is usable by the host, else the first problem found. */
export function checkManifestShape(m: unknown): string | null {
  if (!isObj(m)) return 'manifest is not an object';
  const v = m.datasetVersion;
  if (typeof v !== 'string' || !DATASET_VERSION_RE.test(v)) return 'bad datasetVersion';
  if (!Array.isArray(m.chunks)) return 'chunks is not an array';
  const prefix = `/data/${v}/`;
  const seen = new Set<string>();
  for (let i = 0; i < m.chunks.length; i++) {
    const c: unknown = m.chunks[i];
    if (!isObj(c)) return `chunks.${i} is not an object`;
    if (typeof c.cellId !== 'string' || !CELL_ID_RE_COPY.test(c.cellId))
      return `chunks.${i}.cellId is invalid`;
    if (seen.has(c.cellId)) return `chunks.${i}.cellId is a duplicate`;
    seen.add(c.cellId);
    const b = c.bbox;
    if (
      !Array.isArray(b) ||
      b.length !== 4 ||
      !b.every((x) => typeof x === 'number' && Number.isFinite(x)) ||
      b[0] > b[2] ||
      b[1] > b[3]
    )
      return `chunks.${i}.bbox is invalid`;
    if (typeof c.url !== 'string' || !c.url.startsWith(prefix)) return `chunks.${i}.url is invalid`;
    if (typeof c.parcelCount !== 'number' || !Number.isInteger(c.parcelCount) || c.parcelCount < 0)
      return `chunks.${i}.parcelCount is invalid`;
  }
  return null;
}
