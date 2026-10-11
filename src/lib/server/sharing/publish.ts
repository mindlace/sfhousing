// POST /api/plans (spec §4.3). Steps run in the table's order; the first failure returns.
import { MAX_PLAN_BYTES, parsePlan, serializePlan, type PlanError } from '$lib/plan';
import { getDb } from '$lib/server/db';
import type { ShareErrorCode } from '$lib/sharing/api';
import { planPath } from '$lib/sharing/api';
import { serverMessage } from '$lib/sharing/copy';
import { sha256Hex } from '$lib/sharing/hash';
import { newPlanId } from '$lib/sharing/ids';
import { enforceRate } from './rate-limit';
import { readCapped } from './read-body';
import { json, shareError } from './respond';
import { findPlanByHash, insertPlan } from './store';

export interface PublishDeps {
  newId?: () => string;
  now?: () => Date;
}

const MAX_DETAILS = 20;
const MAX_INSERT_ATTEMPTS = 3;

/** Maps plan-model parse errors to a share error; the first error's code decides. */
export function errorForParse(errors: PlanError[]): {
  status: number;
  code: ShareErrorCode;
  details?: PlanError[];
} {
  switch (errors[0]?.code) {
    case 'not-json':
      return { status: 400, code: 'invalid_json' };
    case 'future-schema':
    case 'unknown-schema':
      return { status: 422, code: 'unsupported_schema' };
    case 'too-many-ops':
      return { status: 422, code: 'too_many_ops' };
    case 'too-large':
      return { status: 413, code: 'too_large' };
    default:
      return { status: 422, code: 'invalid_plan', details: errors.slice(0, MAX_DETAILS) };
  }
}

export async function handlePublish(
  event: { request: Request; platform: App.Platform | undefined },
  deps: PublishDeps = {}
): Promise<Response> {
  const { request, platform } = event;
  const newId = deps.newId ?? (() => newPlanId());
  const now = deps.now ?? (() => new Date());

  // 1. Media type (parameters such as charset are ignored).
  const mediaType = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (mediaType !== 'application/json') return shareError(415, 'unsupported_media_type');

  try {
    const env = (platform?.env ?? {}) as Partial<Env>;

    // 2. Rate limit before the body is touched, so a flood costs no read or parse work.
    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    if (!(await enforceRate(env.PUBLISH_RL, 'publish:' + ip, env))) {
      return shareError(429, 'rate_limited', { headers: { 'Retry-After': '60' } });
    }

    // 3. Declared size.
    const cl = request.headers.get('content-length');
    if (cl !== null && Number(cl) > MAX_PLAN_BYTES) {
      return shareError(413, 'too_large', { message: serverMessage('too_large', Number(cl)) });
    }

    // 4. Received size: the header is not trusted.
    const read = await readCapped(request, MAX_PLAN_BYTES);
    if (!read.ok) return shareError(413, 'too_large');

    // 5. Parse and validate.
    const parsed = parsePlan(read.text);
    if (!parsed.ok) {
      const { status, code, details } = errorForParse(parsed.errors);
      return shareError(status, code, details ? { details } : {});
    }
    const plan = parsed.value;

    // 6. Empty plans are not published.
    if (plan.ops.length === 0) return shareError(422, 'empty_plan');

    // 7. The dataset version must exist in R2.
    const bucket = env.BUCKET;
    if (!bucket) throw new Error('R2 binding BUCKET unavailable');
    const manifest = await bucket.head('data/' + plan.datasetVersion + '/manifest.json');
    if (manifest === null) return shareError(422, 'unknown_dataset_version');

    // 8. Dedupe on the canonical body's hash.
    const body = serializePlan(plan);
    const hash = await sha256Hex(body);
    const db = getDb(platform);
    const existing = await findPlanByHash(db, hash);
    if (existing) return json(200, { id: existing.id });

    // 9. Insert, retrying on PK collision; a content_hash conflict is a racing identical publish.
    const row = {
      schema: plan.schema,
      datasetVersion: plan.datasetVersion,
      body,
      contentHash: hash,
      opCount: plan.ops.length,
      byteSize: new TextEncoder().encode(body).byteLength,
      createdAt: now()
    };
    for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt++) {
      const id = newId();
      if (await insertPlan(db, { id, ...row })) {
        return json(201, { id }, { Location: planPath(id) });
      }
      const raced = await findPlanByHash(db, hash);
      if (raced) return json(200, { id: raced.id });
    }
    throw new Error(`plan id collided on all ${MAX_INSERT_ATTEMPTS} attempts`);
  } catch (e) {
    // Never log the rate-limit key or the client IP.
    console.error('[plans] publish failed:', e instanceof Error ? e.message : 'unknown error');
    return shareError(500, 'server_error');
  }
}
