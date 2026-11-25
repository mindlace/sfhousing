import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/** The game lives at `/` (one address): a permanent redirect, the query dropped. */
export const load: PageLoad = () => {
  redirect(308, '/');
};
