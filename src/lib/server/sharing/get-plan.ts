// GET /api/plans/:id (spec §4.4). The stored body is already canonical Plan JSON.
import { getDb } from '$lib/server/db';
import type { DocCodec } from '$lib/sharing/doc-codec';
import { PLAN_ID_RE } from '$lib/sharing/ids';
import { shareError } from './respond';
import { findPlanById } from './store';

// Not `immutable`, so a manual takedown (§4.9) expires from caches within an hour.
const CACHE = 'public, max-age=3600';

/** If-None-Match uses weak comparison (RFC 9110 §13.1.2): a `W/` prefix is ignored. */
function etagMatches(ifNoneMatch: string, etag: string): boolean {
  return ifNoneMatch
    .split(',')
    .map((t) => t.trim())
    .some((t) => t === '*' || t.replace(/^W\//, '') === etag);
}

export async function handleGetPlan(
  event: {
    params: { id: string };
    request: Request;
    platform: App.Platform | undefined;
  },
  codec: DocCodec<unknown>
): Promise<Response> {
  const { params, request, platform } = event;
  const kind = codec.kind;
  if (!PLAN_ID_RE.test(params.id)) return shareError(404, 'not_found', { kind });

  try {
    const row = await findPlanById(getDb(platform), params.id);
    // A row of the other kind is not found here: its page redirects, the API does not.
    if (!row || row.kind !== kind) return shareError(404, 'not_found', { kind });

    const etag = `"${row.contentHash}"`;
    const headers = { etag, 'cache-control': CACHE };
    const inm = request.headers.get('if-none-match');
    if (inm !== null && etagMatches(inm, etag)) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(row.body, {
      status: 200,
      headers: { 'content-type': 'application/json', ...headers }
    });
  } catch (e) {
    console.error('[plans] get failed:', e instanceof Error ? e.message : 'unknown error');
    return shareError(500, 'server_error', { kind });
  }
}
