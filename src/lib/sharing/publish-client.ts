import type { Plan } from '$lib/plan';
import { isShareError, type ShareErrorCode } from './api';
import { copyFor } from './copy';
import { PLAN_CODEC, type DocCodec, type DocKind } from './doc-codec';

export type PublishOutcome =
  { ok: true; id: string } | { ok: false; code: ShareErrorCode | 'network'; retryAfter?: number };

export type PublishFailure = Exclude<PublishOutcome, { ok: true }>;

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_AFTER_S = 60;

const NETWORK: PublishFailure = { ok: false, code: 'network' };

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

async function interpret(res: Response): Promise<PublishOutcome> {
  const body = await readJson(res);
  if (res.ok) {
    const id = (body as { id?: unknown } | undefined)?.id;
    return typeof id === 'string' ? { ok: true, id } : { ok: false, code: 'server_error' };
  }
  if (res.status === 429 || (isShareError(body) && body.error.code === 'rate_limited')) {
    const retryAfter = Number(res.headers.get('retry-after')) || DEFAULT_RETRY_AFTER_S;
    return { ok: false, code: 'rate_limited', retryAfter };
  }
  if (isShareError(body)) return { ok: false, code: body.error.code };
  return res.status >= 500 ? NETWORK : { ok: false, code: 'server_error' };
}

/** Plan wrapper over {@link publishDoc}. */
export function publishPlan(
  plan: Plan,
  opts: { fetchFn?: typeof fetch; timeoutMs?: number } = {}
): Promise<PublishOutcome> {
  return publishDoc(PLAN_CODEC, plan, opts);
}

/**
 * POSTs codec.serialize(doc) to codec.api. A 15 s timeout (AbortController), a rejected
 * fetch, or a 5xx without a ShareError body all come back as `network`.
 */
export async function publishDoc<D>(
  codec: DocCodec<D>,
  doc: D,
  opts: { fetchFn?: typeof fetch; timeoutMs?: number } = {}
): Promise<PublishOutcome> {
  const fetchFn = opts.fetchFn ?? fetch;
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<PublishOutcome>((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort();
      resolve(NETWORK);
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  });
  const request = (async (): Promise<PublishOutcome> => {
    try {
      const res = await fetchFn(codec.api, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: codec.serialize(doc),
        signal: ctrl.signal
      });
      return await interpret(res);
    } catch {
      return NETWORK;
    }
  })();
  try {
    return await Promise.race([request, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/** The error copy for a failed publish (spec §4.6). `bytes` is the size of the document sent. */
export function publishErrorMessage(
  o: PublishFailure,
  bytes: number,
  kind: DocKind = 'plan'
): string {
  const c = copyFor(kind);
  switch (o.code) {
    case 'too_large':
      return c.tooLarge(bytes);
    case 'too_many_ops':
      return c.tooManyOps;
    case 'unknown_dataset_version':
      return c.unknownDataset;
    case 'invalid_plan':
    case 'unsupported_schema':
    case 'invalid_json':
    case 'unsupported_media_type':
    case 'empty_plan':
      return c.cannotRead(o.code);
    case 'rate_limited':
      return c.rateLimited;
    case 'network':
    case 'server_error':
    case 'not_found':
      return c.network;
  }
}

/** Codes whose copy asks the user to report the problem (shown with an issues link). */
export const isReportable = (code: PublishFailure['code']): boolean =>
  code === 'invalid_plan' ||
  code === 'unsupported_schema' ||
  code === 'invalid_json' ||
  code === 'unsupported_media_type' ||
  code === 'empty_plan';
