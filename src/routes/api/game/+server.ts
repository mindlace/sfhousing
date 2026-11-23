import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { accountLine, listGames } from '$lib/server/game/store';

export const GET: RequestHandler = async ({ locals, platform }) => {
  if (!locals.user) return new Response(null, { status: 401 });
  const db = getDb(platform!);
  const [line, lists] = await Promise.all([
    accountLine(db, locals.user),
    listGames(db, locals.user.id, new Date())
  ]);
  return json({ ...line, saves: lists.saves, removed: lists.removed });
};
