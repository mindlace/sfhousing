import { describe, expect, it, vi } from 'vitest';
import { serializePlan, type Plan } from '$lib/plan';
import type { ShareErrorCode } from './api';
import { COPY, cannotRead, tooLarge } from './copy';
import { isReportable, publishErrorMessage, publishPlan } from './publish-client';
import small from './fixtures/plans/small.json';

const plan = small as Plan;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  });

const shareError = (code: ShareErrorCode) => ({ error: { code, message: 'x' } });

describe('publishPlan', () => {
  it('posts serializePlan(plan) to /api/plans with the JSON content type', async () => {
    const fetchFn = vi.fn(async () => json(201, { id: 'AbCdEfGh' }));
    await publishPlan(plan, { fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/plans');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(init.body).toBe(serializePlan(plan));
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('201 with an id is ok', async () => {
    const fetchFn = vi.fn(async () => json(201, { id: 'AbCdEfGh' }));
    expect(await publishPlan(plan, { fetchFn })).toEqual({ ok: true, id: 'AbCdEfGh' });
  });

  it('200 with an id (dedupe) is ok', async () => {
    const fetchFn = vi.fn(async () => json(200, { id: 'ZzYyXxWw' }));
    expect(await publishPlan(plan, { fetchFn })).toEqual({ ok: true, id: 'ZzYyXxWw' });
  });

  it('2xx without a string id is a server error', async () => {
    const fetchFn = vi.fn(async () => json(201, { nope: 1 }));
    expect(await publishPlan(plan, { fetchFn })).toEqual({ ok: false, code: 'server_error' });
  });

  it('413 body → too_large', async () => {
    const fetchFn = vi.fn(async () => json(413, shareError('too_large')));
    expect(await publishPlan(plan, { fetchFn })).toEqual({ ok: false, code: 'too_large' });
  });

  it.each<ShareErrorCode>(['too_many_ops', 'unknown_dataset_version', 'invalid_plan'])(
    '422 %s body → that code',
    async (code) => {
      const fetchFn = vi.fn(async () => json(422, shareError(code)));
      expect(await publishPlan(plan, { fetchFn })).toEqual({ ok: false, code });
    }
  );

  it('429 with Retry-After: 5 → rate_limited, retryAfter 5', async () => {
    const fetchFn = vi.fn(async () =>
      json(429, shareError('rate_limited'), { 'retry-after': '5' })
    );
    expect(await publishPlan(plan, { fetchFn })).toEqual({
      ok: false,
      code: 'rate_limited',
      retryAfter: 5
    });
  });

  it('429 without Retry-After → retryAfter 60', async () => {
    const fetchFn = vi.fn(async () => json(429, shareError('rate_limited')));
    expect(await publishPlan(plan, { fetchFn })).toEqual({
      ok: false,
      code: 'rate_limited',
      retryAfter: 60
    });
  });

  it('429 with a non-JSON body (edge) is still rate_limited', async () => {
    const fetchFn = vi.fn(async () => new Response('slow down', { status: 429 }));
    expect(await publishPlan(plan, { fetchFn })).toEqual({
      ok: false,
      code: 'rate_limited',
      retryAfter: 60
    });
  });

  it('502 with a non-JSON body → network', async () => {
    const fetchFn = vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 }));
    expect(await publishPlan(plan, { fetchFn })).toEqual({ ok: false, code: 'network' });
  });

  it('a 4xx with a non-JSON body → server_error', async () => {
    const fetchFn = vi.fn(async () => new Response('nope', { status: 418 }));
    expect(await publishPlan(plan, { fetchFn })).toEqual({ ok: false, code: 'server_error' });
  });

  it('fetch rejecting → network', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await publishPlan(plan, { fetchFn })).toEqual({ ok: false, code: 'network' });
  });

  it('a fetch that never resolves times out → network (and aborts)', async () => {
    let signal: AbortSignal | undefined;
    const fetchFn = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    expect(await publishPlan(plan, { fetchFn: fetchFn as typeof fetch, timeoutMs: 20 })).toEqual({
      ok: false,
      code: 'network'
    });
    expect(signal?.aborted).toBe(true);
  });

  it('a fetch that ignores abort still times out → network', async () => {
    const fetchFn = vi.fn(() => new Promise<Response>(() => {}));
    expect(await publishPlan(plan, { fetchFn: fetchFn as typeof fetch, timeoutMs: 20 })).toEqual({
      ok: false,
      code: 'network'
    });
  });
});

describe('publishErrorMessage', () => {
  const bytes = 300_000;
  it.each<[ShareErrorCode | 'network', string]>([
    ['too_large', tooLarge(bytes)],
    ['too_many_ops', COPY.tooManyOps],
    ['unknown_dataset_version', COPY.unknownDataset],
    ['invalid_plan', cannotRead('invalid_plan')],
    ['unsupported_schema', cannotRead('unsupported_schema')],
    ['invalid_json', cannotRead('invalid_json')],
    ['unsupported_media_type', cannotRead('unsupported_media_type')],
    ['empty_plan', cannotRead('empty_plan')],
    ['rate_limited', COPY.rateLimited],
    ['network', COPY.network],
    ['server_error', COPY.network],
    ['not_found', COPY.network]
  ])('%s → spec copy', (code, expected) => {
    expect(publishErrorMessage({ ok: false, code }, bytes)).toBe(expected);
  });
});

describe('isReportable', () => {
  it('is true exactly for the cannot-read codes', () => {
    const yes = [
      'invalid_plan',
      'unsupported_schema',
      'invalid_json',
      'unsupported_media_type',
      'empty_plan'
    ];
    for (const c of yes) expect(isReportable(c as ShareErrorCode)).toBe(true);
    for (const c of [
      'too_large',
      'too_many_ops',
      'rate_limited',
      'network',
      'server_error'
    ] as const)
      expect(isReportable(c)).toBe(false);
  });
});
