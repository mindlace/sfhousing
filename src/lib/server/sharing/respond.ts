// JSON responses for the share API: always application/json and (unless overridden) no-store.
// No CORS headers are ever set: the API is same-origin only.
import type { PlanError } from '$lib/plan';
import type { ShareError, ShareErrorCode } from '$lib/sharing/api';
import { serverMessage } from '$lib/sharing/copy';
import type { DocKind } from '$lib/sharing/doc-codec';

export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }
  });
}

export function shareError(
  status: number,
  code: ShareErrorCode,
  opts: {
    message?: string;
    details?: PlanError[];
    headers?: Record<string, string>;
    /** Which document's wording the default message uses; plans when omitted. */
    kind?: DocKind;
  } = {}
): Response {
  const error: ShareError['error'] = {
    code,
    message: opts.message ?? serverMessage(code, undefined, opts.kind)
  };
  if (opts.details) error.details = opts.details;
  return json(status, { error } satisfies ShareError, opts.headers);
}
