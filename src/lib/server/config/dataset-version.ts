import { error } from '@sveltejs/kit';
import { DATASET_VERSION_RE } from '$lib/data/dataset-version';

const MAX_ECHO = 64;

/** Returns a valid dataset version or fails the request with a 500. Never falls back to a default. */
export function requireDatasetVersion(value: string | undefined): string {
  if (value === undefined || value === '') {
    error(
      500,
      'PUBLIC_DATASET_VERSION is not set; configure it in wrangler.jsonc vars (or --var) — refusing to fall back to a default dataset'
    );
  }
  if (!DATASET_VERSION_RE.test(value)) {
    const shown = value.length > MAX_ECHO ? `${value.slice(0, MAX_ECHO)}…` : value;
    error(
      500,
      `PUBLIC_DATASET_VERSION "${shown}" does not match the dataset version pattern (YYYY-MM-DD-<8 hex> or fixture-N)`
    );
  }
  return value;
}
