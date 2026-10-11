// e2e-only plan seeding (see $lib/server/sharing/e2e-seed). The VITE_E2E check comes first and
// is replaced at build time, so in a normal build the seed call is dead code and only the 404
// branch ships.
import { handleE2eSeed } from '$lib/server/sharing/e2e-seed';
import { shareError } from '$lib/server/sharing/respond';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = (event) => {
  if (import.meta.env.VITE_E2E !== '1') return shareError(404, 'not_found');
  return handleE2eSeed(event, { e2eEnabled: true });
};
