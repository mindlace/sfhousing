import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { MAX_SAVE_BYTES } from '$lib/game/save-api';
import { parseGameSave } from '$lib/game/save-shape';
import { getDb } from '$lib/server/db';
import { accountLine, putGame, readGame, removeGame } from '$lib/server/game/store';
import { isKnownDevice } from '$lib/server/onboarding/known-device';
import { mintPseudonymousSession } from '$lib/server/onboarding/pseudonymous-mint';
import { enforceRate } from '$lib/server/security/rate-limit';
import { refuseUnlessSameOriginJson } from '$lib/server/security/same-origin-json';

const empty = (status: number) => new Response(null, { status });
const invalid = () => json({ error: 'invalid' }, { status: 422 });

export const GET: RequestHandler = async ({ locals, platform, params }) => {
  if (!locals.user) return empty(401);
  const found = await readGame(getDb(platform!), locals.user.id, params.id);
  if (!found) return empty(404);
  if (found.kind === 'removed') return empty(410);
  return json({ rev: found.rev, save: found.save });
};

export const PUT: RequestHandler = async (event) => {
  const { locals, platform, params, request, cookies } = event;

  const refused = refuseUnlessSameOriginJson(event);
  if (refused) return refused;

  const declared = Number(request.headers.get('content-length'));
  if (declared > MAX_SAVE_BYTES) return empty(413);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_SAVE_BYTES) return empty(413);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return invalid();
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return invalid();
  const { baseRev, save: rawSave } = parsed as { baseRev?: unknown; save?: unknown };
  if (
    baseRev !== null &&
    !(typeof baseRev === 'number' && Number.isInteger(baseRev) && baseRev > 0)
  ) {
    return invalid();
  }
  const save = parseGameSave(rawSave);
  if (!save || save.id !== params.id) return invalid();

  let user = locals.user;
  if (!user) {
    if (isKnownDevice(cookies)) return json({ error: 'sign_in' }, { status: 401 });
    if (save.state.firstWinAt === null) return json({ error: 'no_win' }, { status: 422 });
    const minted = await mintPseudonymousSession(event);
    if (!minted.ok) {
      if (minted.status === 429) return empty(429);
      return json({ error: minted.message }, { status: 500 });
    }
    user = minted.user;
  }

  if (
    !(await enforceRate(
      platform!.env.MUTATION_REGISTERED_RL,
      `game_write:${user.id}`,
      platform!.env
    ))
  ) {
    return empty(429);
  }

  const db = getDb(platform!);
  const answer = await putGame(db, user.id, save, baseRev as number | null);
  switch (answer.kind) {
    case 'stored':
      return json({ ...(await accountLine(db, user)), rev: answer.rev });
    case 'conflict':
      return json({ rev: answer.rev, save: answer.save }, { status: 409 });
    case 'removed':
      return empty(410);
    case 'too_many':
      return json({ error: 'too_many' }, { status: 422 });
  }
};

export const DELETE: RequestHandler = async (event) => {
  const refused = refuseUnlessSameOriginJson(event);
  if (refused) return refused;
  const { locals, platform, params } = event;
  if (!locals.user) return empty(401);
  if (
    !(await enforceRate(
      platform!.env.MUTATION_REGISTERED_RL,
      `game_write:${locals.user.id}`,
      platform!.env
    ))
  ) {
    return empty(429);
  }
  await removeGame(getDb(platform!), locals.user.id, params.id, new Date());
  return empty(204);
};
