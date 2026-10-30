// /fzp is no longer a page (plan 3, Call 14): a 307 to /sim with every query parameter kept and
// `start=fzp` added, which opens the Family Zoning Plan comparison. 307 is temporary, so the route
// can change again without browsers caching a permanent redirect.
import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => {
  const params = new URLSearchParams(url.searchParams);
  params.set('start', 'fzp');
  redirect(307, `/sim?${params}`);
};
