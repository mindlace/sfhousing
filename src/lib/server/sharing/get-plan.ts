// GET /api/plans/:id (spec §4.4). The stored body is already canonical Plan JSON.
import { getDb } from '$lib/server/db';
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

export async function handleGetPlan(event: {
  params: { id: string };
  request: Request;
  platform: App.Platform | undefined;
}): Promise<Response> {
  const { params, request, platform } = event;
  if (!PLAN_ID_RE.test(params.id)) return shareError(404, 'not_found');

  try {
    const row = await findPlanById(getDb(platform), params.id);
    if (!row) return shareError(404, 'not_found');

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
    return shareError(500, 'server_error');
  }
}
