// POST /api/e2e/plans: e2e-only seeding of raw plan rows for states the public API refuses to
// create (a retired dataset version, an unparsable stored body). Writing through the preview's
// own D1 binding avoids an out-of-process `wrangler d1 execute` racing the running server for the
// SQLite file (SQLITE_BUSY). Reachable only in a VITE_E2E build running with
// ENVIRONMENT=development; the route adapter compiles the call out of every other build.
import { getDb } from '$lib/server/db';
import { sha256Hex } from '$lib/sharing/hash';
import { newPlanId } from '$lib/sharing/ids';
import { CODECS } from './codecs';
import { json, shareError } from './respond';
import { findPlanByHash, insertPlan } from './store';

export const E2E_SEED_DEFAULT_DATASET = 'fixture-0000';
export const E2E_SEED_CREATED_AT = Date.UTC(2026, 9, 1);

export async function handleE2eSeed(
  event: { request: Request; platform: App.Platform | undefined },
  opts: { e2eEnabled: boolean }
): Promise<Response> {
  const { request, platform } = event;
  if (!opts.e2eEnabled || platform?.env?.ENVIRONMENT !== 'development') {
    return shareError(404, 'not_found');
  }

  let payload: { body?: unknown; datasetVersion?: unknown; kind?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return shareError(400, 'invalid_json', { message: 'e2e seed: body is not JSON' });
  }
  const { body, datasetVersion, kind = 'plan' } = payload ?? {};
  if (
    typeof body !== 'string' ||
    (datasetVersion !== undefined && typeof datasetVersion !== 'string') ||
    (kind !== 'plan' && kind !== 'sim')
  ) {
    return shareError(400, 'invalid_json', {
      message: "e2e seed: expected { body: string; datasetVersion?: string; kind?: 'plan' | 'sim' }"
    });
  }

  const codec = CODECS[kind];
  const parsed = codec.load(body);
  const db = getDb(platform);
  const version = datasetVersion ?? E2E_SEED_DEFAULT_DATASET;
  // Namespaced so a seed never shares a hash with a real publish (whose hash is of the bare
  // canonical body): publish can't dedupe onto a seeded row, nor a seed collide with a publish.
  const contentHash = await sha256Hex(
    'e2e-seed\n' + (kind === 'plan' ? '' : kind + '\n') + version + '\n' + body
  );
  const id = newPlanId();
  const inserted = await insertPlan(db, {
    id,
    kind,
    schema: 1,
    datasetVersion: version,
    body,
    contentHash,
    opCount: parsed.ok ? codec.opCount(parsed.value) : 0,
    byteSize: new TextEncoder().encode(body).byteLength,
    createdAt: new Date(E2E_SEED_CREATED_AT)
  });
  if (inserted) return json(201, { id });

  // The preview's local D1 persists across runs, so seeding the same body and version again
  // (repeat-each, a rerun) reuses the existing row.
  const existing = await findPlanByHash(db, contentHash);
  if (existing) return json(200, { id: existing.id });
  return shareError(500, 'server_error', { message: 'e2e seed: plan id collided' });
}
