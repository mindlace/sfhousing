import { error } from '@sveltejs/kit';
import { DATASET_VERSION_RE } from '$lib/data/dataset-version';

const MAX_ECHO = 64;

/**
 * Returns a valid dataset version or fails the request with a 500. Never falls back to a default.
 * `name` labels the source in the message.
 */
export function requireDatasetVersion(
  value: string | undefined,
  name = 'PUBLIC_DATASET_VERSION'
): string {
  if (value === undefined || value === '') {
    error(500, `${name} is not set; refusing to fall back to a default dataset`);
  }
  if (!DATASET_VERSION_RE.test(value)) {
    const shown = value.length > MAX_ECHO ? `${value.slice(0, MAX_ECHO)}…` : value;
    error(
      500,
      `${name} "${shown}" does not match the dataset version pattern (YYYY-MM-DD-<8 hex> or fixture-N)`
    );
  }
  return value;
}

/** The development override `PUBLIC_DATASET_VERSION` from a platform env, when it is a string. */
export function devOverride(env: unknown): string | undefined {
  if (typeof env !== 'object' || env === null) return undefined;
  const v = (env as Record<string, unknown>).PUBLIC_DATASET_VERSION;
  return typeof v === 'string' ? v : undefined;
}

/**
 * The dataset version to serve: the built version, unless this is development and a non-empty
 * override is set (e.g. `fixture-0` for dev and e2e).
 */
export function resolveDatasetVersion(a: {
  built: string;
  override: string | undefined;
  development: boolean;
}): string {
  if (a.development && a.override) return requireDatasetVersion(a.override);
  return requireDatasetVersion(a.built, 'built dataset version');
}
