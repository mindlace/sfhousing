import type { PlanError } from '$lib/plan';

export type ShareErrorCode =
  | 'invalid_json'
  | 'invalid_plan'
  | 'unsupported_schema'
  | 'too_large'
  | 'too_many_ops'
  | 'empty_plan'
  | 'unknown_dataset_version'
  | 'unsupported_media_type'
  | 'rate_limited'
  | 'not_found'
  | 'server_error';

export interface ShareError {
  error: { code: ShareErrorCode; message: string; details?: PlanError[] };
}

export const SHARE_ERROR_CODES: readonly ShareErrorCode[] = [
  'invalid_json',
  'invalid_plan',
  'unsupported_schema',
  'too_large',
  'too_many_ops',
  'empty_plan',
  'unknown_dataset_version',
  'unsupported_media_type',
  'rate_limited',
  'not_found',
  'server_error'
];

export function isShareError(v: unknown): v is ShareError {
  if (typeof v !== 'object' || v === null) return false;
  const e = (v as { error?: unknown }).error;
  if (typeof e !== 'object' || e === null) return false;
  const { code, message } = e as { code?: unknown; message?: unknown };
  return (
    typeof message === 'string' &&
    typeof code === 'string' &&
    (SHARE_ERROR_CODES as readonly string[]).includes(code)
  );
}

export const planPath = (id: string) => `/p/${id}`;
