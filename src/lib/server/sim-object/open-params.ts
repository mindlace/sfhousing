import { DATASET_VERSION_RE } from '$lib/data/dataset-version';
import { SIM_TITLE_MAX } from '$lib/members/copy';
import { BUILD_MAX } from '$lib/sim-log';

/** The header the Worker sets on the upgrade request it forwards to the object. */
export const OPEN_HEADER = 'x-sfh-sim-open';

const IDENTITY_MAX = 64;
const KEYS = ['identity', 'write', 'title', 'datasetVersion', 'build'];

/** What the Worker tells the object when it opens a socket (R46, R53, R58). */
export interface OpenParams {
  identity: string | null;
  write: boolean;
  title: string;
  datasetVersion: string;
  build: string;
}

/** JSON with every non-ASCII character escaped, so it is a valid header value. */
export function encodeOpenParams(p: OpenParams): string {
  return JSON.stringify(p).replace(
    /[^\x20-\x7e]/g,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')
  );
}

function inRange(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length >= 1 && v.length <= max;
}

/** Null unless the header is exactly an OpenParams: identity null or 1 to 64 characters, write
 *  false when identity is null, title 1 to SIM_TITLE_MAX characters, datasetVersion matching
 *  DATASET_VERSION_RE, build 1 to BUILD_MAX characters. */
export function parseOpenParams(header: string | null): OpenParams | null {
  if (header === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(header);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== KEYS.length || !KEYS.every((k) => keys.includes(k))) return null;
  const { identity, write, title, datasetVersion, build } = o;
  if (identity !== null && !inRange(identity, IDENTITY_MAX)) return null;
  if (typeof write !== 'boolean') return null;
  if (write && identity === null) return null;
  if (!inRange(title, SIM_TITLE_MAX)) return null;
  if (typeof datasetVersion !== 'string' || !DATASET_VERSION_RE.test(datasetVersion)) return null;
  if (!inRange(build, BUILD_MAX)) return null;
  return { identity, write, title, datasetVersion, build };
}
